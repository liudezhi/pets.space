// Amounts are stored as integer fen on each new order, including pending orders.
export const lilyDays = 7;
export const products = Object.freeze({
  foundation: { name: '基础建园', amountFen: 3900, detail: '园主资格、纪念照片、文字和分享设置均包含在内。' },
  lily: { name: '白百合', amountFen: 600, detail: `送到这座花园，在石前展示 ${lilyDays} 天。` },
  vase: { name: '陶瓷花瓶', amountFen: 1800, detail: '长期摆放在这座花园的纪念石旁。' },
  courtyard: { name: '家庭庭院', amountFen: 8800, detail: '一次升级，可把自己名下的多个纪念地放在同一座家庭庭院。' },
});
