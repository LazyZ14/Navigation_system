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
| 离线 MBTiles | `data/tiles/` | MapLibre 离线底图 |
| 构建元信息 JSON | `data/metadata/` | 追溯输入、边界、时间和命令 |

每次构建必须在元信息中记录输入文件名、SHA-256、地图边界、UTC 构建时间、工具版本及完整构建命令。

## 构建 OSRM 路网

```bash
cp /path/to/map.osm data/raw/map.osm
./scripts/build_osrm.sh data/raw/map.osm
docker compose up -d osrm
```

脚本使用 OSRM 的 MLD 流程：`osrm-extract`、`osrm-partition`、`osrm-customize`。构建完成后，`data/metadata/map.osm-build.json` 保留输入校验值、OSM 边界、构建时间和命令。
