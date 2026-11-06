const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const stockService = require('../services/stockService');

router.use(rateLimit({ windowMs: 60000, max: 240, standardHeaders: true, legacyHeaders: false }));

// Public read endpoint used by display devices, like /weather. Upstream hosts are fixed.
router.get('/', async (req, res) => {
  const market = req.query.market || 'auto';
  try { stockService.normalizeSymbol(req.query.symbol, market); } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    const data = await stockService.getStock(req.query.symbol, market);
    res.set('Cache-Control', 'no-store');
    return res.json({ data });
  } catch (_) {
    return res.status(502).json({ error: 'Stock data unavailable. Please retry later.' });
  }
});

module.exports = router;
