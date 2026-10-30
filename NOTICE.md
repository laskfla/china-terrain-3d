# 第三方数据与库

| 内容 | 来源 | 许可 / 说明 |
| --- | --- | --- |
| 全球地形图 `elev_bump_4k.jpg`、水体掩膜 `water_4k.png` | NASA Visible Earth / Blue Marble，经 [turban/webgl-earth](https://github.com/turban/webgl-earth) 分发 | NASA 影像一般不受版权保护，使用时应注明 NASA 为来源 |
| 中国省级行政区、世界国家边界（`map/js/china.js`、`map/js/world.js`） | [Apache ECharts 4.9.0](https://github.com/apache/echarts/tree/4.9.0/map/js) | Apache License 2.0 |
| three.js r147（运行时从 jsDelivr 加载） | [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT License |
| Noto Serif SC、JetBrains Mono 字体（运行时从 Google Fonts 加载） | Google Fonts | SIL Open Font License 1.1 |
| 历代疆域、朝代阶段、都城与古城、历史河道与湖泊（`tools/build_history.js` 处理后嵌入 `index.html`） | [DeanChensj/jiangshan-map（江山时序）](https://github.com/DeanChensj/jiangshan-map)，提交 `b66b846` | GNU GPL v3.0；历史边界为示意性复原 |
| 河流走向、地名坐标 | 本项目手工整理 | 近似位置，仅作示意 |
| 居延泽、东西居延海的轮廓（`tools/build_history.js` 内手绘，jiangshan-map 无此湖） | 东湖范围、1958 年面积：[《生态学报》2014 年第 34 卷第 8 期](https://www.ecologica.cn/stxb/ch/html/2014/8/stxb201306171720.htm)；西湖坐标、干涸年份：[Wikipedia: Juyan Lake](https://en.wikipedia.org/wiki/Juyan_Lake)；秦汉面积约 720 km²、两湖 1958 年面积：[浙江在线转载报道](https://china.zjol.com.cn/gnxw/201611/t20161128_2122445.shtml)（新闻引述，未见原始文献）；古湖约公元 250 年后干涸：检索摘要中的相关研究，原文未核实 | 形状为示意；居延泽的位置（约 41.9°N、101.7°E）未查到出处，按记忆中的文献和地形低洼处估定 |

`sources/` 目录下的源数据不随仓库提交，用 `tools/fetch_sources.sh` 下载。`index.html` 内嵌的是由这些数据处理后的结果。
