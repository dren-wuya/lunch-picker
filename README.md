# 午餐随机选择器

一个面向上海陆家嘴中心 L+MALL 泰康大厦工作日午餐的手机优先静态网页。第一版不需要账号、后端或构建步骤，所有历史和设置都保存在当前浏览器中。

完整产品边界见 [SPEC.md](SPEC.md)。

## 本地运行

浏览器不能稳定地从 `file://` 地址读取默认 JSON，因此请在仓库目录启动任意静态文件服务器。例如：

```powershell
python -m http.server 8000
```

然后访问 `http://localhost:8000/`。

## 验证

项目没有第三方运行时依赖。随机与数据规则使用 Node.js 内置测试运行器验证：

```powershell
node --test
```

## 数据

- 默认白名单位于 `data/restaurants.json`；首版包含 20 家主范围和 8 家副范围餐厅。
- 参考人均和副范围步行时间是公开信息基础上的近似值，不是实时承诺；默认列表核验日期为 2026-08-27。
- 网页可导出 `restaurants.json` 或完整的 `lunch-picker-backup.json`，导入采用校验后整体替换，不会自动合并。
- 个人历史只存在浏览器本地；不要把个人导出文件提交到公开仓库。

## GitHub Pages

代码只使用相对路径，发布源为 `main` 分支根目录。

- Repository: https://github.com/dren-wuya/lunch-picker
- Pages: https://dren-wuya.github.io/lunch-picker/
