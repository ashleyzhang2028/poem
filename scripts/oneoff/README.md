# 一次性脚本

按 Issue 跑过一遍即失效的历史迁移脚本：`apply-*`（把某张手工表落到语料上）、
`fix-*-source`（出处 / 朝代勘正）、`remove-mingren-*`（按收录尺子删人）。
它们**不是**常规生成脚本 —— 扩展数据只跑 README「扩展数据」那一节列的几条。

需要复跑时直接 `node scripts/oneoff/<名字>.js`；数据表在 `scripts/data/`，
未随脚本一起搬。
