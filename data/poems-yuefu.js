window.POEMS_YUEFU = [
  {
    textRef: "yuefu-yf-1",
    id: "yf-1",
    title: "孔雀东南飞",
    source: "《乐府诗集》",
    dynasty: "汉",
    author: "佚名",
    gradeGroup: "汉乐府",
    excerpt: "孔雀东南飞，五里一徘徊",
  },
  {
    textRef: "yuefu-yf-2",
    id: "yf-2",
    title: "陌上桑",
    source: "《乐府诗集》",
    dynasty: "汉",
    author: "佚名",
    gradeGroup: "汉乐府",
    excerpt: "日出东南隅，照我秦氏楼",
  },
  {
    textRef: "poems-xx5-21",
    id: "yf-3",
    title: "长歌行",
    source: "《乐府诗集》",
    dynasty: "汉",
    author: "佚名",
    gradeGroup: "汉乐府",
    excerpt: "青青园中葵，朝露待日晞",
  },
  {
    textRef: "yuefu-yf-4",
    id: "yf-4",
    title: "十五从军征",
    source: "《乐府诗集》",
    dynasty: "汉",
    author: "佚名",
    gradeGroup: "汉乐府",
    excerpt: "十五从军征，八十始得归",
  },
  {
    textRef: "poems-xx6-09",
    id: "yf-5",
    title: "迢迢牵牛星",
    source: "《乐府诗集》",
    dynasty: "汉",
    author: "佚名",
    gradeGroup: "汉乐府",
    excerpt: "迢迢牵牛星，皎皎河汉女",
  },
  {
    textRef: "yuefu-yf-6",
    id: "yf-6",
    title: "上邪",
    source: "《乐府诗集》",
    dynasty: "汉",
    author: "佚名",
    gradeGroup: "汉乐府",
    excerpt: "上邪！我欲与君相知",
  },
  {
    textRef: "yuefu-yf-7",
    id: "yf-7",
    title: "有所思",
    source: "《乐府诗集》",
    dynasty: "汉",
    author: "佚名",
    gradeGroup: "汉乐府",
    excerpt: "有所思，乃在大海南",
  },
  {
    textRef: "poems-cz7-13",
    id: "yf-8",
    title: "木兰诗",
    source: "《乐府诗集》",
    dynasty: "南北朝",
    author: "佚名",
    gradeGroup: "北朝乐府",
    excerpt: "唧唧复唧唧，木兰当户织",
  },
  {
    textRef: "poems-xx2-07",
    id: "yf-9",
    title: "敕勒歌",
    source: "《乐府诗集》",
    dynasty: "南北朝",
    author: "佚名",
    gradeGroup: "北朝乐府",
    excerpt: "敕勒川，阴山下",
  },
  {
    textRef: "yuefu-yf-10",
    id: "yf-10",
    title: "陇头歌辞",
    source: "《乐府诗集》",
    dynasty: "南北朝",
    author: "佚名",
    gradeGroup: "北朝乐府",
    excerpt: "陇头流水，流离山下",
  },
  {
    textRef: "yuefu-yf-11",
    id: "yf-11",
    title: "折杨柳歌辞",
    source: "《乐府诗集》",
    dynasty: "南北朝",
    author: "佚名",
    gradeGroup: "北朝乐府",
    excerpt: "上马不捉鞭，反折杨柳枝",
  },
  {
    textRef: "yuefu-yf-12",
    id: "yf-12",
    title: "西洲曲",
    source: "《乐府诗集》",
    dynasty: "南北朝",
    author: "佚名",
    gradeGroup: "南朝乐府",
    excerpt: "忆梅下西洲，折梅寄江北",
  },
  {
    textRef: "yuefu-yf-13",
    id: "yf-13",
    title: "子夜歌",
    source: "《乐府诗集》",
    dynasty: "南北朝",
    author: "佚名",
    gradeGroup: "南朝乐府",
    excerpt: "宿昔不梳头，丝发披两肩",
  },
  {
    textRef: "yuefu-yf-14",
    id: "yf-14",
    title: "华山畿",
    source: "《乐府诗集》",
    dynasty: "南北朝",
    author: "佚名",
    gradeGroup: "南朝乐府",
    excerpt: "华山畿！君既为侬死",
  },
  {
    textRef: "yuefu-yf-15",
    id: "yf-15",
    title: "莫愁乐",
    source: "《乐府诗集》",
    dynasty: "南北朝",
    author: "佚名",
    gradeGroup: "南朝乐府",
    excerpt: "莫愁在何处？莫愁石城西",
  },
];

(function () {
  window.YUEFU_ALL = window.POEMS_YUEFU;
  window.getYuefuById = function (id) {
    return window.POEMS_YUEFU.filter(function (p) { return p.id === id; })[0] || null;
  };
  window.getYuefuGroups = function () {
    var groups = [];
    window.POEMS_YUEFU.forEach(function (p) {
      var g = p.gradeGroup || "其他";
      var hit = groups.filter(function (it) { return it.name === g; })[0];
      if (!hit) { hit = { name: g, items: [] }; groups.push(hit); }
      hit.items.push(p);
    });
    return groups;
  };
})();
