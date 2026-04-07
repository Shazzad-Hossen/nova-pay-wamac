module.exports.healthCheck = () => async (req, res) => {
  try {
    return res.status(200).send({ status: 'server is running' });
  } catch (error) {
    console.error('❌ Health error:', error);
    return res.status(500).send({ message: 'Internal server error' });
  }
};
