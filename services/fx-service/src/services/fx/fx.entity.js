const {
  normalizeCurrency,
  isValidCurrency,
  normalizeAmount,
  roundFx
} = require('./fx.service');

module.exports.convertCurrency = ({ pool }) => async (req, res) => {
  let client;

  try {
    const {
      from_currency: fromCurrencyRaw,
      to_currency: toCurrencyRaw,
      amount: amountRaw,
      rate: rateRaw
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

    if (effectiveRate !== null) {
      await client.query(
        `INSERT INTO exchange_rates (from_currency, to_currency, rate, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (from_currency, to_currency)
         DO UPDATE SET rate = EXCLUDED.rate, updated_at = NOW()`,
        [fromCurrency, toCurrency, effectiveRate]
      );
    } else {
      const rateRes = await client.query(
        `SELECT rate, updated_at
         FROM exchange_rates
         WHERE from_currency = $1 AND to_currency = $2`,
        [fromCurrency, toCurrency]
      );

      if (rateRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Exchange rate not found. Provide rate in request to set it.'
        });
      }

      effectiveRate = Number(rateRes.rows[0].rate);
    }

    const convertedAmount = roundFx(amount * effectiveRate);

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      from_currency: fromCurrency,
      to_currency: toCurrency,
      amount,
      rate: roundFx(effectiveRate),
      converted_amount: convertedAmount
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
