const {
  normalizeCurrency,
  isValidCurrency,
  normalizeAmount,
  roundFx
} = require('./fx.service');

const getRate = async (client, fromCurrency, toCurrency) => {
  const rateRes = await client.query(
    `SELECT rate, updated_at
     FROM exchange_rates
     WHERE from_currency = $1 AND to_currency = $2`,
    [fromCurrency, toCurrency]
  );

  if (rateRes.rowCount === 0) {
    return null;
  }

  return {
    rate: Number(rateRes.rows[0].rate),
    provider: 'internal_book'
  };
};

module.exports.createQuote = ({ pool, settings }) => async (req, res) => {
  let client;
  try {
    const { from_currency: fromCurrencyRaw, to_currency: toCurrencyRaw, amount: amountRaw } = req.body;
    const fromCurrency = normalizeCurrency(fromCurrencyRaw);
    const toCurrency = normalizeCurrency(toCurrencyRaw);
    const amount = normalizeAmount(amountRaw);

    if (!fromCurrency || !toCurrency || amount === null) {
      return res.status(400).json({ success: false, message: 'from_currency, to_currency and amount are required' });
    }

    if (!isValidCurrency(fromCurrency) || !isValidCurrency(toCurrency)) {
      return res.status(400).json({ success: false, message: 'Currency codes must be 3-letter ISO format' });
    }

    if (amount <= 0) {
      return res.status(400).json({ success: false, message: 'amount must be greater than 0' });
    }

    client = await pool.connect();
    await client.query('BEGIN');

    const bookRate = await getRate(client, fromCurrency, toCurrency);
    if (!bookRate) {
      await client.query('ROLLBACK');
      return res.status(503).json({
        success: false,
        message: 'FX provider unavailable for requested pair'
      });
    }

    const quoteRes = await client.query(
      `INSERT INTO fx_quotes (from_currency, to_currency, amount, rate, provider, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' seconds')::interval)
       RETURNING id, from_currency, to_currency, amount, rate, provider, expires_at, used_at, created_at`,
      [fromCurrency, toCurrency, amount, bookRate.rate, bookRate.provider, settings.quoteTtlSeconds]
    );

    await client.query('COMMIT');
    const q = quoteRes.rows[0];

    return res.status(201).json({
      success: true,
      quote_id: q.id,
      from_currency: q.from_currency,
      to_currency: q.to_currency,
      amount: Number(q.amount),
      rate: Number(q.rate),
      provider: q.provider,
      expires_at: q.expires_at
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('❌ FX quote error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  } finally {
    if (client) client.release();
  }
};

module.exports.convertCurrency = ({ pool }) => async (req, res) => {
  let client;

  try {
    const {
      from_currency: fromCurrencyRaw,
      to_currency: toCurrencyRaw,
      amount: amountRaw,
      rate: rateRaw,
      quote_id: quoteId
    } = req.body;

    const fromCurrency = normalizeCurrency(fromCurrencyRaw);
    const toCurrency = normalizeCurrency(toCurrencyRaw);
    const amount = normalizeAmount(amountRaw);
    const providedRate = rateRaw === undefined || rateRaw === null ? null : normalizeAmount(rateRaw);

    if (!fromCurrency || !toCurrency || amount === null) {
      return res.status(400).json({
        success: false,
        message: 'from_currency, to_currency and amount are required'
      });
    }

    if (!isValidCurrency(fromCurrency) || !isValidCurrency(toCurrency)) {
      return res.status(400).json({
        success: false,
        message: 'Currency codes must be 3-letter ISO format (e.g., USD, EUR)'
      });
    }

    if (fromCurrency === toCurrency) {
      return res.status(400).json({
        success: false,
        message: 'from_currency and to_currency cannot be the same'
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'amount must be greater than 0'
      });
    }

    if (providedRate !== null && providedRate <= 0) {
      return res.status(400).json({
        success: false,
        message: 'rate must be greater than 0 when provided'
      });
    }

    client = await pool.connect();
    await client.query('BEGIN');

    let effectiveRate = providedRate;
    let provider = 'request_override';

    if (quoteId) {
      const quoteRes = await client.query(
        `SELECT id, rate, provider, expires_at, used_at
         FROM fx_quotes
         WHERE id = $1
         FOR UPDATE`,
        [quoteId]
      );

      if (quoteRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Quote not found' });
      }

      const quote = quoteRes.rows[0];
      if (quote.used_at) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, message: 'Quote already used' });
      }

      if (new Date(quote.expires_at) < new Date()) {
        await client.query('ROLLBACK');
        return res.status(410).json({ success: false, message: 'Quote expired' });
      }

      effectiveRate = Number(quote.rate);
      provider = quote.provider;
      await client.query('UPDATE fx_quotes SET used_at = NOW() WHERE id = $1', [quote.id]);
    } else if (effectiveRate !== null) {
      await client.query(
        `INSERT INTO exchange_rates (from_currency, to_currency, rate, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (from_currency, to_currency)
         DO UPDATE SET rate = EXCLUDED.rate, updated_at = NOW()`,
        [fromCurrency, toCurrency, effectiveRate]
      );
    } else {
      const bookRate = await getRate(client, fromCurrency, toCurrency);
      if (!bookRate) {
        await client.query('ROLLBACK');
        return res.status(503).json({
          success: false,
          message: 'FX provider unavailable for requested pair'
        });
      }
      effectiveRate = Number(bookRate.rate);
      provider = bookRate.provider;
    }

    const convertedAmount = roundFx(amount * effectiveRate);

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      from_currency: fromCurrency,
      to_currency: toCurrency,
      amount,
      rate: roundFx(effectiveRate),
      converted_amount: convertedAmount,
      provider
    });
  } catch (error) {
    console.error('❌ FX convert error:', error);

    if (client) {
      await client.query('ROLLBACK');
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  } finally {
    if (client) client.release();
  }
};
