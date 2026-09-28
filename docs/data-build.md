# 本地地图数据构建

## 输入

第一阶段输入是用户手动导出的北京区域 `map.osm`。操作人将它复制到被 Git 忽略的 `data/raw/map.osm` 后，先记录校验值：

```bash
shasum -a 256 data/raw/map.osm
```

不得将原始 OSM、OSRM 预处理文件、MBTiles 或 Docker 卷提交到 Git。

## 输出

| 输出 | 目录 | 用途 |
| --- | --- | --- |
| OSRM MLD 数据 | `data/osrm/` | 本地汽车路线服务 |
| 离线主题 GeoJSON | `frontend/public/generated/` | MapLibre 离线底图 |
| 离线 MBTiles（后续性能升级） | `data/tiles/` | 高缩放级别矢量底图 |
| 构建元信息 JSON | `data/metadata/` | 追溯输入、边界、时间和命令 |

每次构建必须在元信息中记录输入文件名、SHA-256、地图边界、UTC 构建时间、工具版本及完整构建命令。

## 构建 OSRM 路网

```bash
cp /path/to/map.osm data/raw/map.osm
./scripts/build_osrm.sh data/raw/map.osm
docker compose up -d osrm
```

脚本使用 OSRM 的 MLD 流程：`osrm-extract`、`osrm-partition`、`osrm-customize`。构建完成后，
`data/metadata/map.osm-osrm-mld-build.json` 保留输入校验值、OSM 边界、构建时间、固定镜像版本、输出与命令。

## 构建当前离线底图

```bash
./scripts/build_tiles.sh data/raw/map.osm
```

当前导出的地图是 OSM XML，而 tilemaker 仅接收 PBF。脚本因此从同一份本地 OSM 生成八类离线 GeoJSON：

- 五类基础几何：`roads.geojson`、`buildings.geojson`、`water.geojson`、`green.geojson`、`landuse.geojson`
- 三类标签：`road-labels.geojson`、`place-labels.geojson`、`poi.geojson`

MapLibre 从 `/generated/` 加载它们，不访问在线瓦片服务。构建器允许任一主题产出合法的空 `FeatureCollection`；北京 Demo 的
smoke test 则额外要求八类文件均存在。

标签命名优先使用 `name:zh`，回退到 `name`，再到 `name:en`。空名称或无名称的要素不会进入标签输出。

面状 multipolygon 仅按 OSM node reference ID 拼接 way；无法闭合、缺失成员或嵌套成员的 relation 会跳过并以确定顺序
报告。成功 relation 会保留 outer/inner（洞）语义，并消费同类别 member way，避免 relation 与 standalone polygon 重叠；
relation 失败时，其相关 member way 也不会作为该类别的 standalone 回退输出。

标签锚点使用确定性扫描线算法计算 polygon 内部代表点，确保点位于 outer 内且不在任何 hole 中。无法找到可靠内部锚点的 polygon
会被跳过并报告。

对应的 `data/metadata/map.osm-maplibre-thematic-geojson-build.json` 独立记录同一输入的校验值、边界、
Python/XML 工具版本、输出与完整命令，避免覆盖 OSRM 构建记录。

本轮仅交付上述八类离线地图语义和导航叠加；sprites、MBTiles、矢量瓦片、glyph 服务器、icon font 均为后续增强，不能由构建脚本或前端运行时隐式引入。中文标签使用浏览器本地字体（`localIdeographFontFamily`），不请求外部 glyph 服务。
