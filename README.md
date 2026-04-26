# Pixel Edit

一个基于浏览器的轻量像素画编辑工具，使用 Vite、React 和 TypeScript 构建。

## 功能

- 画笔、橡皮和取色工具
- 撤销与重做历史记录
- 16x16、32x32、64x64 画布预设
- 像素网格开关和缩放控制
- 图片导入，支持适配当前画布或按原图尺寸导入（最大边 256）
- 透明 PNG 导出，支持 1x、4x、8x、16x 倍率

## 开发

```powershell
npm install
npm run dev
```

启动后打开终端显示的本地地址，通常是：

```text
http://127.0.0.1:5173/
```

## 检查

```powershell
npm run lint
npm run build
```
