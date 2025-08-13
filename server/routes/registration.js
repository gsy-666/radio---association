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

// 获取所有报名信息
router.get('/', async (req, res) => {
  try {
    const registrations = await Registration.find();
    res.status(200).json(registrations);
  } catch (error) {
    res.status(500).json({ message: '获取报名信息失败' });
  }
});

// 根据ID获取单个报名信息
router.get('/:id', async (req, res) => {
  try {
    const registration = await Registration.findById(req.params.id);
    if (!registration) {
      return res.status(404).json({ message: '未找到报名信息' });
    }
    res.status(200).json(registration);
  } catch (error) {
    res.status(500).json({ message: '获取报名信息失败' });
  }
});

module.exports = router;