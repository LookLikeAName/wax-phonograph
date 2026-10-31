// 網頁版：存檔就是觸發瀏覽器下載
export default {
  name: 'web',
  async saveFile(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
};
