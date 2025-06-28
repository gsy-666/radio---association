const express = require('express');
const router = express.Router();
const Registration = require('../models/Registration');

// 处理表单提交的 API 端点
router.post('/', async (req, res) => {
  try {
    const newRegistration = new Registration(req.body);
    await newRegistration.save();
    res.status(200).json({ message: '报名成功！' });
  } catch (error) {
    res.status(500).json({ message: '报名失败，请稍后再试。' });
  }
});

module.exports = router;