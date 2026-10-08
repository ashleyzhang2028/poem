/* Issue #505 · 古诗第四批（末批）8 首（用户 2026-10-08 投喂的第 151~200 组）
   --------------------------------------------------------------------------
   落库 8 首非唐古诗（gs-75…gs-81），其余课内 / 集内已有、按判重口径合流不重录。
   壳挂 textRef，正文只在本文件落一份。 */
(function (root) {
  "use strict";

  var POEMS = [
    {
      id: "gs-75", title: "山中杂诗", source: "《吴朝请集》",
      dynasty: "南朝·梁", author: "吴均", gradeGroup: "六朝诗",
      text: "山际见来烟，竹中窥落日。\n鸟向檐上飞，云从窗里出。",
      translation: "山边看见飘来的烟雾，竹林中窥见落下的太阳。\n鸟儿向屋檐上飞去，云彩从窗户里飘出。",
      translationSource: "public-domain"
    },
    {
      id: "gs-76", title: "画眉鸟", source: "《欧阳文忠公集》",
      dynasty: "宋", author: "欧阳修", gradeGroup: "宋诗",
      text: "百啭千声随意移，山花红紫树高低。\n始知锁向金笼听，不及林间自在啼。",
      translation: "画眉鸟千百遍地婉转鸣叫，随意飞动，山花有红有紫，树木有高有低。\n这才知道把它锁在金笼里听它叫，比不上在林间自由自在地啼唱。",
      translationSource: "public-domain"
    },
    {
      id: "gs-77", title: "蚕妇吟", source: "《叠山集》",
      dynasty: "宋", author: "谢枋得", gradeGroup: "宋诗",
      text: "子规啼彻四更时，起视蚕稠怕叶稀。\n不信楼头杨柳月，玉人歌舞未曾归。",
      translation: "杜鹃鸟一直啼到四更天，养蚕妇起身看蚕多怕桑叶不够。\n她不信楼头杨柳上挂着的月亮下，美人还在轻歌曼舞没有回家。",
      translationSource: "public-domain"
    },
    {
      id: "gs-78", title: "蚕妇", source: "《张俞集》",
      dynasty: "宋", author: "张俞", gradeGroup: "宋诗",
      text: "昨日入城市，归来泪满巾。\n遍身罗绮者，不是养蚕人。",
      translation: "昨天进城里去，回来时眼泪湿透了手巾。\n那些浑身穿着绫罗绸缎的人，都不是养蚕的人。",
      translationSource: "public-domain"
    },
    {
      id: "gs-79", title: "论诗", source: "《瓯北集》",
      dynasty: "清", author: "赵翼", gradeGroup: "元明清诗",
      text: "李杜诗篇万口传，至今已觉不新鲜。\n江山代有才人出，各领风骚数百年。",
      translation: "李白、杜甫的诗篇万人传诵，到现在已经觉得不新鲜了。\n江山代代都有才人出现，各自引领诗坛风骚几百年。",
      translationSource: "public-domain"
    },
    {
      id: "gs-80", title: "读《岳阳楼记》", source: "《梅溪集》",
      dynasty: "宋", author: "王十朋", gradeGroup: "宋诗",
      text: "先忧后乐范文正，此志此言高孟轲。\n暇日登临固宜乐，其如天下有忧何。",
      translation: "先天下之忧而忧、后天下之乐而乐的范仲淹，他的志向和话语比孟轲还高。\n闲暇时登楼观览固然应当快乐，可是天下还有忧愁，又能怎么办呢。",
      translationSource: "public-domain"
    },
    {
      id: "gs-81", title: "天平山中", source: "《眉庵集》",
      dynasty: "明", author: "杨基", gradeGroup: "元明清诗",
      text: "细雨茸茸湿楝花，南风树树熟枇杷。\n徐行不记山深浅，一路莺啼送到家。",
      translation: "细雨蒙蒙沾湿了楝花，南风吹来，一树一树的枇杷都熟透了。\n慢慢地走，不记得山路的深浅，一路黄莺啼叫着送我回到家。",
      translationSource: "public-domain"
    },
  ];

  root.POEMS_CORPUS_505C = POEMS;
})(typeof window !== "undefined" ? window : globalThis);
