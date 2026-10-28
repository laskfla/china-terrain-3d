# 第三方数据与库

| 内容 | 来源 | 许可 / 说明 |
| --- | --- | --- |
| 全球地形图 `elev_bump_4k.jpg`、水体掩膜 `water_4k.png` | NASA Visible Earth / Blue Marble，经 [turban/webgl-earth](https://github.com/turban/webgl-earth) 分发 | NASA 影像一般不受版权保护，使用时应注明 NASA 为来源 |
| 中国省级行政区、世界国家边界（`map/js/china.js`、`map/js/world.js`） | [Apache ECharts 4.9.0](https://github.com/apache/echarts/tree/4.9.0/map/js) | Apache License 2.0 |
| three.js r147（运行时从 jsDelivr 加载） | [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT License |
| Noto Serif SC、JetBrains Mono 字体（运行时从 Google Fonts 加载） | Google Fonts | SIL Open Font License 1.1 |
| 历代疆域、朝代阶段、都城与古城（`tools/build_history.js` 处理后嵌入 `index.html`） | [DeanChensj/jiangshan-map（江山时序）](https://github.com/DeanChensj/jiangshan-map)，提交 `b66b846` | GNU GPL v3.0；历史边界为示意性复原 |
| 河流走向、地名坐标 | 本项目手工整理 | 近似位置，仅作示意 |

`sources/` 目录下的源数据不随仓库提交，用 `tools/fetch_sources.sh` 下载。`index.html` 内嵌的是由这些数据处理后的结果。
