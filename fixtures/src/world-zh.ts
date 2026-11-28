// The Chinese side of the fixture world (SPEC §4.6, §4.12 "Fixtures and tests", §7; routine/STYLE-ZH.md is the guide): the
// Traditional Chinese, as used in Taiwan, of every English string of the sample world that a Chinese draft or the sample site
// content shows. One table, keyed by the English string, so that no English text has two translations and the stage that builds
// the sample content (a stored finding's `L10n` values) reads the same words the Chinese drafts hold:
//   - each finding's title, six explainer parts, figure alt text, string rung notes, `since_then` texts and glossary definitions
//     (`world-findings.ts`);
//   - the brief-level prose of the four editions: the Lead, the returning update, the ideas, the Also noted titles, the deep dive,
//     the big pictures, the remarkable note, the strongest evidence against, the two corrections' `after` and `reason`, and the
//     report decision's reason (`drafts.ts`, `world.ts`);
//   - the seven glossary terms' Chinese names, and for three of them the 樂詞網 entry the pass is said to have found (an
//     invented page that `zh-inputs.ts` writes, marked SAMPLE and never fetched).
// A text of several paragraphs (a deep dive, a big picture) is looked up paragraph by paragraph, so each paragraph is a pair here.
//
// How the translations are written, each point checked by tests/fixtures-zh.test.ts through the checks of lib/zh.ts:
//   - A title keeps the SAMPLE mark and its colon, written full-width (SAMPLE：). Every name of a person, institution, journal,
//     system or paper stays in English as the English wrote it (Marlow Labs, Journal of Tiling Theory), which also lets ZH_TERMS
//     skip a fixed term inside a name kept whole.
//   - Numbers keep their value (ZH_PARITY): 12 million is 1,200 萬, 40,000 is 4 萬, 60,000 is 6 萬, "per cent" is %, a digit stays
//     a digit, and a number word from one to ten may be a Chinese numeral.
//   - The English term follows its first use in a finding's explainer in full-width brackets, and no later use and no title has it
//     (ZH_ENGLISH_ONCE). A term in a definition or a brief-level text carries no brackets.
//   - A How sure we are starts with the label of its rung as lib/vocab.ts writes it (ZH_RUNG_LABEL): 宣稱, 預印本, 已查核, 已證實,
//     已應用. The same goes for a correction's `after` on a How sure we are, and for the rung's word inside a deep dive.
//   - A sentence that stands in two strings (a correction's `after` and the background it corrects, a returning update and the
//     `since_then` text it becomes) is the same Chinese in both. The trial sentence is the same in the story and the deep dive.
//   - A glossary term and its definition are judged together (ZH_TERMS): the papyrus definition does not repeat 莎草紙, because the
//     term's own `zh` holds it.
//   - Full-width punctuation, a space between Latin letters or digits and Han characters, no dash, no hype word, Taiwan usage
//     (the avoid list of config/terms-zh.json), and each string within the cap its kind has (ZH_CHARS).
//   - Each claim keeps its strength (STYLE-ZH §12): "says", "claims" and "argues" stay 表示, 宣稱 and 主張, "could", "may" and "might"
//     stay 可能 (or 或許, 有機會, 不一定), and no possibility is added or turned into a fact. Two sentences keep a plain 可以 or 能,
//     because their "may" and "could" mean permission and ability.
//   - Plain words (STYLE-ZH §10): 這個 and not 該, 它的 and not 其, a verb and not 對X進行Y or 加以. One wording for each phrase
//     the world repeats: "no tie" is 沒有關聯, "the maker" 開發者, "sealed" 密封, "relies on" 依靠, "a safety trial" 安全性試驗, and
//     "people" against an AI is 人類.
// An English string that is not in the table is an error (`zhText()` throws), so a changed sample sentence fails loudly instead of
// keeping a stale translation.
//
// New for this project; Cyber has no Chinese pass.

import type { L10n } from "../../lib/schema/common";
import type { Finding } from "../../lib/schema/finding";
import type { GlossaryFile, Term } from "../../lib/schema/glossary";

/** One sample string and its Chinese. */
type Pair = readonly [en: string, zh: string];

/** Every pair, in the order the world holds the English: the findings in publication order, then the briefs. */
const PAIRS: readonly Pair[] = [
  // ── disputedOld (math-2026-0131, mathematics, item, notable) ──
  // title
  [
    "SAMPLE: An AI checker flags a gap in a published proof",
    "SAMPLE：AI 查核工具指出已發表的證明有缺漏",
  ],
  // found
  [
    "Marlow Labs says its AI checker, Gapfinder, read a published proof in number theory and flagged a gap in one step.",
    "Marlow Labs 表示，它的 AI 查核工具 Gapfinder 讀了一份已發表的數論證明，指出其中一個步驟有缺漏。",
  ],
  // matters
  [
    "Mathematicians rely on checks like this to trust long proofs, so a flagged gap needs a careful answer.",
    "數學家靠這類查核來信任很長的證明，所以被指出的缺漏需要審慎回應。",
  ],
  // ai_helped
  [
    "Marlow Labs built Gapfinder, which found the gap with no human help.",
    "Marlow Labs 開發了 Gapfinder，它在沒有人類協助下找出這個缺漏。",
  ],
  // how_sure
  [
    "Preprint. arXiv hosts the paper, which has not been peer reviewed. Marlow Labs, the maker of the checker, is the source of the claim.",
    "預印本。論文放在 arXiv 上，尚未經過同儕審查。查核工具的開發者 Marlow Labs 是這項說法的來源。",
  ],
  // background
  [
    "A published proof is one that a journal has accepted.",
    "已發表的證明，是指期刊已經接受的證明。",
  ],
  // could_lead
  [
    "If the gap is real, the authors could repair the step or withdraw the proof.",
    "如果缺漏屬實，作者可能修補這個步驟，或撤回這份證明。",
  ],
  // rung note 1 (disputed)
  [
    "Kestrel College says the authors reject the claim and say the flagged step is correct.",
    "Kestrel College 表示，作者否定這項說法，並稱被指出的步驟是正確的。",
  ],

  // ── fellW0 (phys-2026-0134, physics, item, major) ──
  // title
  [
    "SAMPLE: A robot lab reports a magnetic material that keeps its strength",
    "SAMPLE：機器人實驗室報告保有磁力的磁性材料",
  ],
  // found
  [
    "A robot lab run by an AI planner reported a new magnetic material that keeps its strength up to 400 degrees.",
    "一間由 AI 規劃系統運作的機器人實驗室，報告了一種新的磁性材料，溫度高達 400 度時仍保有磁力。",
  ],
  // matters
  [
    "Strong magnets that work in the heat could help motors and generators, so a new material with that property would be useful.",
    "能在高溫下運作的強力磁鐵，可能有助於馬達和發電機，所以具有這種特性的新材料會很有用。",
  ],
  // ai_helped
  [
    "Hartwell Materials Lab built the Cobalt Planner, which chose each sample to make next. Robots made and tested the samples.",
    "Hartwell Materials Lab 開發了 Cobalt Planner，由它挑選下一個要製作的樣本。機器人製作並測試這些樣本。",
  ],
  // how_sure
  [
    "Checked. Sample Physics Letters published the paper after peer review. Hartwell Materials Lab, the maker of the planner, wrote the paper.",
    "已查核。Sample Physics Letters 在同儕審查後發表了這篇論文。規劃系統的開發者 Hartwell Materials Lab 撰寫了這篇論文。",
  ],
  // background
  [
    "A magnet loses strength as it gets hot, and each material has its own limit.",
    "磁鐵變熱時磁力會減弱，每種材料都有各自的極限。",
  ],
  // could_lead
  [
    "If other labs repeat the result, the material could be tried in real machines.",
    "如果其他實驗室重現這項結果，這種材料可能會在實際的機器上試用。",
  ],

  // ── tilings (math-2026-0140, mathematics, story, landmark) ──
  // title
  [
    "SAMPLE: Tiles that fill a surface only without repeating",
    "SAMPLE：只能以不重複的方式鋪滿平面的磁磚",
  ],
  // found
  [
    "Two mathematicians at Eastvale University proved that tiles of one kind can fill a flat surface only in patterns that never repeat. Mathematicians had left this question open since 1968. The proof runs to 38 pages and needs no computer search. Other mathematicians can follow every step of it by hand, without special tools.",
    "Eastvale University 的兩位數學家證明，同一種磁磚鋪滿平面時，只能排出永不重複的圖案。這個問題自 1968 年起一直懸而未決。這份證明有 38 頁，不需要電腦搜尋。其他數學家不用特殊工具，也能動手把每個步驟走一遍。",
  ],
  // matters
  [
    "Tilings appear in computer science and in the study of materials. A proof that some tiles can never form a repeating pattern tells designers what such patterns can and cannot do. It settles a question that had stood since 1968, and it gives researchers a new method to use.",
    "鋪磚出現在電腦科學和材料研究中。證明某些磁磚永遠排不出重複的圖案，能讓設計者知道這類圖案做得到什麼、做不到什麼。這解決了一個自 1968 年起懸而未決的問題，也給研究者一個可用的新方法。",
  ],
  // how_sure
  [
    "Checked. The Journal of Tiling Theory published the paper after peer review. Two mathematicians who were not on the paper, at Kestrel College and Northgate University, say they read the proof and found no gap. Their words are quoted on this page. The result stands on the journal's review and their reading, not on any claim by the authors.",
    "已查核。Journal of Tiling Theory 在同儕審查後發表了這篇論文。兩位沒有參與論文的數學家，分別任職於 Kestrel College 和 Northgate University，表示他們讀過這份證明，沒有發現缺漏。他們的話引述於本頁。這項結果靠的是期刊的審查和他們的閱讀，不是作者的任何說法。",
  ],
  // background
  [
    "A tiling covers a surface with copies of shapes and leaves no gaps. A floor of square tiles repeats the same pattern again and again. This proof is about tiles that can never do that.",
    "鋪磚是把形狀複製許多份，蓋滿一個表面，不留空隙。鋪滿方形磁磚的地板，會一再重複同樣的圖案。這份證明談的是永遠做不到這一點的磁磚。",
  ],
  // could_lead
  [
    "The method could help with the three-dimensional case, which is still open. It might also help scientists who study materials with patterns that never repeat, and designers who need such patterns in their work.",
    "這個方法可能有助於處理三維的情形，這個問題仍未解決。它也可能幫助科學家研究圖案永不重複的材料，並幫助工作中需要這類圖案的設計者。",
  ],

  // ── weather (earth-2026-0141, earth, story, major) ──
  // title
  [
    "SAMPLE: An AI model forecasts the weather ten days ahead",
    "SAMPLE：AI 模型預報未來十天的天氣",
  ],
  // found
  [
    "Larch Weather Systems built an AI model, Larch Forecast, that predicts the weather up to ten days ahead. In tests on two years of past weather, its ten-day forecasts had about 12 per cent fewer errors. The comparison was with numerical weather prediction, the standard method.",
    "Larch Weather Systems 開發了 AI 模型 Larch Forecast，能預測未來最多十天的天氣。在兩年過往天氣的測試中，它的十天預報錯誤約少了 12%。比較的對象是標準方法：數值天氣預報（numerical weather prediction）。",
  ],
  // matters
  [
    "Forecasts guide farmers, airlines and emergency plans. Fewer errors ten days out gives people more time to prepare for storms and heat. A small gain in accuracy reaches many people at once. Weather agencies pay close attention to any method that beats the standard one.",
    "農民、航空公司和緊急應變計畫，都以預報為依據。提前十天的預報錯誤變少，能讓人們有更多時間為風暴和高溫做準備。準確度小幅提升，也會同時影響許多人。氣象機構會密切留意任何勝過標準方法的做法。",
  ],
  // ai_helped
  [
    "Larch Weather Systems built Larch Forecast. The model learns from past weather records, so it finds patterns in them instead of solving the equations of the air. The company also helped write the paper. The tests in the paper are the company's own.",
    "Larch Weather Systems 開發了 Larch Forecast。這個模型從過去的天氣紀錄中學習，所以它是在這些紀錄中找出規律，而不是求解大氣的方程式。這家公司也參與撰寫論文。論文中的測試是這家公司自己做的。",
  ],
  // how_sure
  [
    "Applied. The Meridian Weather Service says it now relies on the model for its daily forecasts. Science published the paper after peer review, and Larch Weather Systems, the maker, helped write it. The tests used past weather only, so live forecasts may differ.",
    "已應用。Meridian Weather Service 表示，它現在的每日預報依靠這個模型。Science 在同儕審查後發表了這篇論文，開發者 Larch Weather Systems 也參與撰寫。測試只用了過去的天氣，所以實際預報可能不同。",
  ],
  // background
  [
    "For many years, weather agencies have forecast by solving physical equations on large computers. Tests on past weather show how a new model would have done on days that are already known.",
    "多年來，氣象機構都是用大型電腦求解物理方程式來做預報。用過去天氣做測試，能看出新模型在已知的日子裡會有什麼表現。",
  ],
  // could_lead
  [
    "If the gain holds in other seasons and other places, forecasters could trust longer forecasts and warn people earlier. Outside teams may test the model next, on live forecasts and in other regions.",
    "如果這個改善在其他季節和地方也成立，預報員可能信任更長期的預報，並更早發出警示。接下來，外部團隊可能用即時預報和其他地區測試這個模型。",
  ],
  // definition of "numerical weather prediction"
  [
    "The standard way to forecast weather: computers solve the equations of the air and sea, starting from today's measurements.",
    "預報天氣的標準方法：電腦從今天的測量資料出發，求解大氣和海洋的方程式。",
  ],

  // ── catalyst (chem-2026-0142, chemistry, item, notable) ──
  // title
  [
    "SAMPLE: A robotic lab finds a cheap metal mixture that splits water",
    "SAMPLE：機器人實驗室找到能分解水的廉價金屬混合物",
  ],
  // found
  [
    "A robotic lab at Eastvale University tested 200 mixtures of common metals in six weeks. One mixture sped up the splitting of water into hydrogen almost as well as platinum does.",
    "Eastvale University 的機器人實驗室在六週內測試了 200 種常見金屬的混合物。其中一種混合物加快水分解成氫的效果，幾乎和鉑一樣好。",
  ],
  // matters
  [
    "Platinum is rare. A cheap mixture that works nearly as well could make hydrogen from water less costly.",
    "鉑很稀少。一種效果幾乎一樣好的廉價混合物，可能讓從水製氫的成本降低。",
  ],
  // ai_helped
  [
    "Marlow Labs built Marlow Selector, which chose which mixtures to try next. Robot arms mixed and tested the samples.",
    "Marlow Labs 開發了 Marlow Selector，由它挑選接下來要嘗試的混合物。機器手臂混合並測試這些樣本。",
  ],
  // how_sure
  [
    "Checked. The Eastvale Journal of Materials published the paper. The tests ran in one lab, and Marlow Labs, the maker of the AI system, helped write it.",
    "已查核。Eastvale Journal of Materials 發表了這篇論文。測試在一間實驗室進行，AI 系統的開發者 Marlow Labs 也參與撰寫。",
  ],
  // background
  [
    "Splitting water gives hydrogen. The reaction needs a material that speeds it up, and platinum is a common choice.",
    "分解水會得到氫。這個反應需要一種加快反應的材料，鉑是常見的選擇。",
  ],
  // could_lead
  [
    "Robot labs could search many more mixtures in the same time and find other cheap materials.",
    "機器人實驗室可能在同樣的時間內搜尋更多混合物，找到其他廉價材料。",
  ],
  // rung note 1 (confirmed)
  [
    "An independent lab repeated the work and got a matching result.",
    "一間獨立實驗室重複了這項研究，得到相符的結果。",
  ],

  // ── antibiotic (bio-2026-0143, biology, story, major) ──
  // title
  [
    "SAMPLE: An AI model proposes a new antibiotic that works in mice",
    "SAMPLE：AI 模型提出對小鼠有效的新抗生素",
  ],
  // found
  [
    "An AI model proposed a new antibiotic that cleared a drug-resistant skin infection in 8 of 10 mice. The model, Halden Design, ranked about 12 million molecules. The team made and tested 40 of the top ones. Three of the 40 stopped the growth of drug-resistant bacteria in dishes.",
    "AI 模型提出了一種新抗生素，在 10 隻小鼠中的 8 隻清除了抗藥性皮膚感染。這個模型 Halden Design 為大約 1,200 萬個分子排出名次。團隊製作並測試了名次最前面的 40 個。這 40 個當中有 3 個，在培養皿中阻止了抗藥性細菌生長。",
  ],
  // matters
  [
    "Antimicrobial resistance makes some infections hard to treat, and doctors need new antibiotics. A first safety trial of the compound in people is registered as NCT09999001. The trial plans to enrol 24 healthy volunteers. It tests safety, not cure.",
    "抗微生物抗藥性（antimicrobial resistance）讓某些感染難以治療，醫師需要新的抗生素。這個化合物的第一項人體安全性試驗，登記編號為 NCT09999001。這項試驗預計招募 24 名健康志願者。它測試的是安全性，不是治癒。",
  ],
  // ai_helped
  [
    "Halden Research built Halden Design, which ranks molecules by their chance of killing drug-resistant bacteria. The model proposed which molecules to make. People made them and ran every test. The Coldwater Institute ran the mouse tests and runs the safety trial.",
    "Halden Research 開發了 Halden Design，它會依分子殺死抗藥性細菌的機率來排名。這個模型提出要製作哪些分子。人類製作了這些分子，並執行每一項測試。Coldwater Institute 執行了小鼠實驗，並負責進行安全性試驗。",
  ],
  // how_sure
  [
    "Checked. Cell published the paper after peer review. Halden Research, which built the model, helped write the paper, and no other lab has repeated the tests. The Coldwater Institute says it ran the mouse tests and runs the first safety trial.",
    "已查核。Cell 在同儕審查後發表了這篇論文。開發這個模型的 Halden Research 也參與撰寫論文，而且還沒有其他實驗室重複過這些實驗。Coldwater Institute 表示，小鼠實驗由它執行，第一項安全性試驗也由它負責。",
  ],
  // background
  [
    "Drug makers once found antibiotics by testing natural samples one by one. Computers can now rank a huge list of molecules before anyone makes one. That lets labs test only the best candidates.",
    "藥廠過去靠逐一測試天然樣本來尋找抗生素。現在電腦能在有人製作之前，替一大串分子排出名次。這讓實驗室只需測試最好的候選對象。",
  ],
  // could_lead
  [
    "If later trials go well, the compound could become a treatment for drug-resistant infections. It might also show that AI can find other new antibiotics. First, other labs must repeat the tests.",
    "如果後續試驗順利，這個化合物可能成為抗藥性感染的治療方法。它也可能顯示 AI 能找到其他新抗生素。首先，其他實驗室必須重複這些實驗。",
  ],
  // rung note 1 (confirmed)
  [
    "A second lab with no tie to the first repeated the mouse tests.",
    "第二間與第一間沒有關聯的實驗室重複了小鼠實驗。",
  ],
  // since_then 0
  [
    "A second lab, Kestrel College, repeated the mouse tests with its own mice and samples. The compound cleared the infection in 7 of 10 mice. The lab says it has no tie to Halden Research.",
    "第二間實驗室 Kestrel College 用自己的小鼠和樣本重複了小鼠實驗。這個化合物在 10 隻小鼠中的 7 隻清除了感染。這間實驗室表示，它和 Halden Research 沒有關聯。",
  ],
  // definition of "antimicrobial resistance"
  [
    "When germs stop responding to the drugs that used to kill them.",
    "病菌對過去能殺死它們的藥物不再有反應。",
  ],

  // ── retractW0 (soc-2026-0144, social, item, major) ──
  // title
  [
    "SAMPLE: Reviewers shared unpublished papers with an AI chatbot",
    "SAMPLE：審稿人把未發表的論文分享給 AI 聊天機器人",
  ],
  // found
  [
    "The journal Sample Review found that reviewers pasted the text of 31 unpublished manuscripts into a public AI chatbot to help write their reports.",
    "期刊 Sample Review 發現，審稿人把 31 份未發表稿件的內容貼進公開的 AI 聊天機器人，來協助撰寫審查報告。",
  ],
  // matters
  [
    "Authors send unpublished work to a journal in confidence. Pasting it into a public tool breaks that trust and may expose the work.",
    "作者把尚未發表的成果寄給期刊，期待對方保密。把它貼進公開的工具，就違背了這份信任，也可能使成果外洩。",
  ],
  // ai_helped
  [
    "Reviewers used an AI chatbot to help write reports. Sample Review does not name the chatbot.",
    "審稿人用 AI 聊天機器人協助撰寫報告。Sample Review 沒有說出這個聊天機器人的名稱。",
  ],
  // how_sure
  [
    "Checked. Sample Review, the journal involved, says so in its own statement and in an editorial note.",
    "已查核。相關期刊 Sample Review 在自己的聲明和編輯說明中這麼表示。",
  ],
  // background
  [
    "Peer review is the step where outside experts judge a paper before it is published.",
    "同儕審查是論文發表前，由外部專家評斷論文的步驟。",
  ],
  // could_lead
  [
    "Journals could write clear rules and tell reviewers what they may share.",
    "期刊可能訂出明確的規則，告訴審稿人哪些內容可以分享。",
  ],

  // ── policy (soc-2026-0145, social, story, notable) ──
  // title
  [
    "SAMPLE: A research council plans to ask applicants about AI use",
    "SAMPLE：研究委員會計畫詢問申請人使用 AI 的情形",
  ],
  // found
  [
    "The Aldgate Research Council published a draft rule on AI in grant proposals. Applicants would have to say if AI tools helped write any part of a proposal. The draft asks for this statement in the proposal summary only. Comments are open until the end of the year.",
    "Aldgate Research Council 公布了一份關於補助申請書使用 AI 的規則草案。依草案，申請人必須說明，AI 工具是否協助撰寫了申請書的任何部分。草案只要求在申請書摘要中提出這項說明。意見徵詢期開放到年底。",
  ],
  // matters
  [
    "Research councils decide who receives funding. A rule on AI use tells applicants what they must disclose, and it tells reviewers what they are reading. Other funders could copy a rule like this one, so its wording may matter far beyond one council.",
    "研究委員會決定誰能獲得經費。關於 AI 使用的規定，會告訴申請人必須揭露什麼，也告訴審查人他們讀到的是什麼。其他資助機構可能仿效這樣的規定，所以它的措辭，影響所及可能遠遠超出一個委員會。",
  ],
  // ai_helped
  [
    "No AI system is named in the draft. The rule is about AI tools in general: it covers any tool that helped write a proposal. The council asks applicants to say what help they had, not which tool gave it.",
    "草案沒有指名任何 AI 系統。這項規定談的是一般的 AI 工具：凡是協助撰寫申請書的工具，都包含在內。委員會要求申請人說明得到了什麼協助，而不是哪個工具提供的。",
  ],
  // how_sure
  [
    "Claimed. The Aldgate Research Council states the draft in its own announcement. It is a proposal, not yet a rule, and the council may change it after the comment period closes. No other source we read says how the council will act.",
    "宣稱。Aldgate Research Council 在自己的公告中載明了這份草案。它只是提議，還不是正式規定，委員會可能在意見徵詢期結束後修改。我們讀過的其他來源，都沒有說明委員會會怎麼做。",
  ],
  // background
  [
    "Funding councils receive many proposals each year. Writers use many tools, from spell checkers to AI chatbots. A disclosure rule asks them to say what help they had.",
    "補助委員會每年收到許多申請書。寫作者會用許多工具，從拼字檢查到 AI 聊天機器人都有。揭露規定要求他們說明得到了什麼協助。",
  ],
  // could_lead
  [
    "A final rule could set a pattern for other funders. It might also push applicants to hide their use of AI if the rule is unclear. Clear examples in the rule could prevent that.",
    "最終規定可能成為其他資助機構的範本。如果規定不清楚，也可能讓申請人隱瞞自己使用 AI。規定中若有清楚的例子，就可能避免這種情況。",
  ],
  // since_then 0
  [
    "The council published its final rule. From 1 January, applicants must say if AI tools helped write any part of a proposal. The final rule covers every part of a proposal, not only the summary.",
    "委員會公布了最終規定。從 1 月 1 日起，申請人必須說明 AI 工具是否協助撰寫了申請書的任何部分。最終規定涵蓋申請書的每個部分，不只是摘要。",
  ],

  // ── survey (soc-2026-0146, social, item, watch) ──
  // title
  [
    "SAMPLE: An open dataset of 40,000 AI-run survey interviews",
    "SAMPLE：4 萬場由 AI 進行的調查訪談開放資料集",
  ],
  // found
  [
    "The Coldwater Institute survey lab released 40,000 interviews that an AI interviewer ran by chat with adult volunteers.",
    "Coldwater Institute 的調查實驗室公開了 4 萬場訪談，由 AI 訪談員透過聊天，與成年志願者進行。",
  ],
  // matters
  [
    "Surveys take a great deal of time. A shared dataset lets other researchers study how AI interviewers work.",
    "問卷調查非常耗時。共用的資料集，讓其他研究者能研究 AI 訪談員是怎麼運作的。",
  ],
  // ai_helped
  [
    "The Coldwater Institute survey lab built Survey Voice, which asked the questions and followed up on answers. People wrote the questions and checked a sample of the transcripts.",
    "Coldwater Institute 的調查實驗室開發了 Survey Voice，由它提問，並針對回答追問。問題由人類撰寫，並由人類抽查部分逐字稿。",
  ],
  // how_sure
  [
    "Preprint. SSRN hosts the paper, which has not been peer reviewed. The Coldwater Institute survey lab, which built the system, is the source.",
    "預印本。論文放在 SSRN 上，尚未經過同儕審查。這項消息的來源是開發這套系統的 Coldwater Institute 調查實驗室。",
  ],
  // background
  [
    "Researchers use interviews to learn what people think and why.",
    "研究者用訪談來了解人們怎麼想，以及為什麼這麼想。",
  ],
  // could_lead
  [
    "AI interviewers could make large surveys cheaper, if their answers match those of people.",
    "如果 AI 訪談員得到的答案和真人一致，大型問卷調查可能因此變得更便宜。",
  ],

  // ── plasma (phys-2026-0147, physics, item, notable) ──
  // title
  [
    "SAMPLE: An AI controller steadies a fusion test machine",
    "SAMPLE：AI 控制器穩定了核融合實驗裝置",
  ],
  // found
  [
    "An AI controller held a plasma steady in a fusion test machine for 90 seconds, three times longer than the standard controller.",
    "AI 控制器讓核融合實驗裝置中的電漿（plasma）穩定維持了 90 秒，是標準控制器的三倍。",
  ],
  // matters
  [
    "Fusion machines need steady control to work, and long runs are hard to reach. Better control is one step toward fusion power.",
    "核融合裝置需要穩定的控制才能運作，而長時間運轉很難做到。更好的控制，是邁向核融合發電的一步。",
  ],
  // ai_helped
  [
    "Fernhill Fusion Group built the Fernhill Controller, which adjusted the magnets 1,000 times a second. It learned from practice runs.",
    "Fernhill Fusion Group 開發了 Fernhill Controller，它每秒調整磁鐵 1,000 次。它從練習運轉中學習。",
  ],
  // how_sure
  [
    "Checked. Fusion Science Reports published the paper after peer review. Fernhill Fusion Group built the controller, and other groups have not yet repeated the run.",
    "已查核。Fusion Science Reports 在同儕審查後發表了這篇論文。控制器由 Fernhill Fusion Group 開發，其他團隊還沒有重現這次運轉。",
  ],
  // background
  [
    "Fusion power needs a very hot gas held in place by magnets.",
    "核融合發電需要一種被磁鐵固定在原位的極高溫氣體。",
  ],
  // could_lead
  [
    "If other groups repeat the run, AI control could become a standard part of fusion machines.",
    "如果其他團隊重現這次運轉，AI 控制可能成為核融合裝置的標準配備。",
  ],
  // definition of "plasma"
  [
    "A very hot gas whose atoms have lost electrons, the state of matter in the sun and in fusion machines.",
    "原子已失去電子的極高溫氣體，是太陽和核融合裝置中的物質狀態。",
  ],

  // ── scroll (hum-2026-0148, humanities, story, landmark) ──
  // title
  [
    "SAMPLE: A sealed scroll is read without being opened",
    "SAMPLE：不必打開，就讀出了密封卷軸的內容",
  ],
  // found
  [
    "A team at Eastvale University read about 1,800 Greek letters inside a papyrus scroll that cannot be unrolled. The scroll came from the library at Herculaneum. The letters fill six columns of text, and the passage is part of a prose work on friendship.",
    "Eastvale University 的一個團隊，讀出了無法攤開的莎草紙（papyrus）卷軸內約 1,800 個希臘字母。這卷卷軸來自赫庫蘭尼姆的圖書館。這些字母排成六欄文字，這段文字屬於一部談友誼的散文作品。",
  ],
  // matters
  [
    "Hundreds of scrolls from the same library are still sealed. A method that reads them without opening them leaves each scroll whole. Scholars could then study many scrolls, not only this one. One expert calls it the first whole passage of connected prose from a sealed scroll.",
    "同一座圖書館的數百卷卷軸仍然密封著。不打開就能讀的方法，能讓每卷卷軸保持完整。學者就有機會研究許多卷軸，而不只是這一卷。一位專家稱這是第一段從密封卷軸讀出的完整連貫散文。",
  ],
  // ai_helped
  [
    "Eastvale University built a model called the Ink Reader. The team scanned the scroll with X-rays and flattened its layers in software, a step called virtual unwrapping. The Ink Reader, trained on small patches where ink had been found by hand, then marked the ink in the scans. People read the marked letters.",
    "Eastvale University 開發了名為 Ink Reader 的模型。團隊用 X 光掃描卷軸，並在軟體中把它的各層攤平，這個步驟稱為虛擬展開（virtual unwrapping）。Ink Reader 用人工找出墨跡的小片區域來訓練，接著在掃描影像中標出墨跡。由人類讀出被標出的字母。",
  ],
  // how_sure
  [
    "Checked. Nature published the paper after peer review. Scholars in two countries, outside the Eastvale team, checked the readings. Two experts quoted here, at Ravenhurst University and the Coldwater Institute, call the readings careful.",
    "已查核。Nature 在同儕審查後發表了這篇論文。Eastvale 團隊以外、來自兩個國家的學者，檢查了這些判讀。這裡引用的兩位專家，分別任職於 Ravenhurst University 和 Coldwater Institute，稱這些判讀很嚴謹。",
  ],
  // background
  [
    "Mount Vesuvius erupted in AD 79 and buried the Roman town of Herculaneum. The eruption charred hundreds of papyrus scrolls in its library. None of them can be unrolled.",
    "維蘇威火山在西元 79 年噴發，掩埋了羅馬城鎮赫庫蘭尼姆。這次噴發燒焦了這座城鎮圖書館中的數百卷莎草紙卷軸。這些卷軸都無法攤開。",
  ],
  // could_lead
  [
    "The same method could open other sealed scrolls and bring back books that no one has read since the eruption. Scholars may then learn what the library held.",
    "同樣的方法可能讓其他密封的卷軸也能被讀取，找回自噴發以來沒人讀過的書。學者或許就能知道這座圖書館收藏了什麼。",
  ],
  // figure alt
  [
    "A flattened scan of one scroll layer, with the ink the model found marked in yellow over a column of Greek letters.",
    "卷軸其中一層的攤平掃描圖，模型找到的墨跡以黃色標在一欄希臘字母上。",
  ],
  // definition of "virtual unwrapping"
  [
    "Scanning a rolled scroll and flattening its layers on a computer, so the text can be read without unrolling it.",
    "掃描捲起的卷軸，並在電腦上把各層攤平，讓文字不必攤開就能閱讀。",
  ],
  // definition of "papyrus"
  [
    "A writing sheet made from the papyrus plant, used in the ancient Mediterranean world.",
    "用紙莎草製成的書寫紙張，用於古代地中海世界。",
  ],

  // ── protein (bio-2026-0149, biology, item, major) ──
  // title
  [
    "SAMPLE: A lab measures a protein that an AI had predicted",
    "SAMPLE：實驗室測量了 AI 先前預測的蛋白質",
  ],
  // found
  [
    "A second lab measured the shape of a protein complex and found that an AI model had predicted it correctly.",
    "第二間實驗室測量了一個蛋白質複合體的形狀，發現 AI 模型先前的預測是正確的。",
  ],
  // matters
  [
    "A protein's shape shows how it works and how a drug might fit. Measuring a shape is slow.",
    "蛋白質的形狀，顯示它如何運作，以及藥物可能如何契合。測量形狀很費時。",
  ],
  // ai_helped
  [
    "Halden Research built the model, Halden Fold. It posted its prediction before anyone had measured the complex.",
    "Halden Research 開發了這個模型 Halden Fold。它在還沒有人測量這個複合體之前，就公布了預測結果。",
  ],
  // how_sure
  [
    "Confirmed. PNAS published the measured structure, which matches the prediction in every chain. Halden Research did not do the measurement.",
    "已證實。PNAS 發表了測量得到的結構，與預測在每一條鏈上都相符。測量不是 Halden Research 做的。",
  ],
  // background
  [
    "The lab used cryo-electron microscopy, which images frozen molecules, to measure the complex. A first safety trial of a drug that binds the complex is registered as NCT09999002.",
    "實驗室用冷凍電子顯微鏡（cryo-electron microscopy）測量這個複合體，這種技術替冷凍分子成像。一種能與這個複合體結合的藥物，第一項安全性試驗的登記編號為 NCT09999002。",
  ],
  // could_lead
  [
    "If more predictions match, AI could shorten the search for new medicines.",
    "如果有更多預測相符，AI 可能縮短尋找新藥的過程。",
  ],
  // rung note 1 (confirmed)
  [
    "A second lab measured the structure and found the prediction correct.",
    "第二間實驗室測量了結構，發現預測是正確的。",
  ],
  // definition of "cryo-electron microscopy"
  [
    "A way to see the shape of a molecule by imaging it frozen in ice with a beam of electrons.",
    "把分子冷凍在冰中，用電子束成像，藉此看出分子形狀的方法。",
  ],

  // ── retractWD (chem-2026-0150, chemistry, item, major) ──
  // title
  [
    "SAMPLE: Example Press retracts 84 papers with undisclosed AI text",
    "SAMPLE：Example Press 撤稿 84 篇含未揭露 AI 文字的論文",
  ],
  // found
  [
    "Example Press retracted 84 papers in nine journals. The text and images in these papers came from an AI tool that the authors did not disclose.",
    "Example Press 撤稿了九本期刊中的 84 篇論文。這些論文裡的文字和圖片，來自一個作者沒有揭露的 AI 工具。",
  ],
  // matters
  [
    "Other researchers may have cited these papers, so the harm can spread beyond the journals.",
    "其他研究者可能引用了這些論文，所以傷害可能擴散到期刊之外。",
  ],
  // ai_helped
  [
    "An AI tool made the text and images. The publisher's notices do not name the tool.",
    "文字和圖片是由 AI 工具製作的。出版商的通知沒有說出這個工具的名稱。",
  ],
  // how_sure
  [
    "Checked. Example Press, the publisher of the papers, says so in its own statement and in two retraction notices.",
    "已查核。這些論文的出版商 Example Press，在自己的聲明和兩份撤稿通知中這麼表示。",
  ],
  // background
  [
    "A retraction notice tells readers that a paper should no longer be relied on.",
    "撤稿通知是在告訴讀者，不應該再採信這篇論文。",
  ],
  // could_lead
  [
    "Publishers could check for undisclosed AI text before they accept a paper.",
    "出版商可能在接受論文之前，先檢查有沒有未揭露的 AI 文字。",
  ],

  // ── erdos (math-2026-0151, mathematics, item, notable) ──
  // title
  [
    "SAMPLE: An AI lab claims a proof of an open problem",
    "SAMPLE：AI 實驗室宣稱證明了一個未解問題",
  ],
  // found
  [
    "Marlow Labs says its AI system found a proof of an open problem about sums of sets of whole numbers.",
    "Marlow Labs 表示，它的 AI 系統找到一個未解問題的證明，這個問題與整數集合的和有關。",
  ],
  // matters
  [
    "A proof would settle a question that mathematicians had left open.",
    "證明若成立，就能解決數學家一直懸而未決的問題。",
  ],
  // ai_helped
  [
    "Marlow Labs built the Marlow Prover. The lab says the system found the proof with no human step in the argument.",
    "Marlow Labs 開發了 Marlow Prover。這間實驗室表示，這套系統找到了證明，論證中沒有任何人類的步驟。",
  ],
  // how_sure
  [
    "Preprint. arXiv hosts the paper, which has not been peer reviewed. Marlow Labs is the source of the claim.",
    "預印本。論文放在 arXiv 上，尚未經過同儕審查。這項說法的來源是 Marlow Labs。",
  ],
  // background
  [
    "A Lean file posted with the paper lets a proof assistant check the argument by machine.",
    "隨論文附上的 Lean 檔案，能讓證明輔助工具（proof assistant）以機器檢查這份論證。",
  ],
  // could_lead
  [
    "If the Lean file checks, the proof could be accepted without waiting long for referees.",
    "如果 Lean 檔案通過檢查，這份證明可能不必等待審稿人太久，就被接受。",
  ],
  // definition of "proof assistant"
  [
    "A computer program that checks, step by step, that a mathematical proof follows the rules of logic.",
    "一種電腦程式，逐步檢查數學證明是否遵守邏輯規則。",
  ],

  // ── translation (hum-2026-0152, humanities, item, notable) ──
  // title
  [
    "SAMPLE: A university says AI drafted a Bible translation",
    "SAMPLE：大學表示 AI 擬出了聖經翻譯的初稿",
  ],
  // found
  [
    "Quillon University says its language lab used an AI model to draft a Bible translation in a language with 60,000 speakers.",
    "Quillon University 表示，它的語言實驗室用 AI 模型起草了一部聖經翻譯，譯成一種有 6 萬人使用的語言。",
  ],
  // matters
  [
    "Many languages still have no full Bible. A draft that native speakers review could reach readers sooner.",
    "許多語言仍然沒有完整的聖經。由母語人士審閱的草稿，可能更早送到讀者手中。",
  ],
  // ai_helped
  [
    "Quillon University built the Quill Translator, which wrote the draft. Native speakers will review each verse before the translation is shared.",
    "Quillon University 開發了 Quill Translator，由它寫出草稿。在翻譯分享出去之前，母語人士會審閱每一節經文。",
  ],
  // how_sure
  [
    "Claimed. Quillon University says so in its own statement, and the lab has not published a paper. The university built the system.",
    "宣稱。Quillon University 在自己的聲明中這麼表示，這間實驗室還沒有發表論文。這套系統是這所大學開發的。",
  ],
  // background
  [
    "Translators have long worked by hand, one verse at a time.",
    "譯者長期以來都是靠人工，一次翻一節經文。",
  ],
  // could_lead
  [
    "If reviewers find the drafts sound, the method could help smaller language groups.",
    "如果審閱者認為這些草稿可靠，這個方法可能幫助較小的語言群體。",
  ],

  // ── weekday brief ──
  // lead 0
  [
    "Scholars read the writing inside a sealed ancient scroll without opening it.",
    "學者不必打開，就讀出了一卷密封的古代卷軸裡的文字。",
  ],
  // lead 1
  [
    "A lab measured a protein that an AI model had predicted, and the shape matched.",
    "一間實驗室測量了 AI 模型先前預測的蛋白質，形狀相符。",
  ],
  // lead 2
  [
    "A publisher pulled many papers with undisclosed AI text, and a research council made its AI rule final.",
    "一家出版商撤下許多含有未揭露 AI 文字的論文，一個研究委員會也讓它的 AI 規定定案。",
  ],
  // idea 0
  [
    "Oren Nominal (SAMPLE) argues that journals should let AI check every submitted proof before human review begins.",
    "Oren Nominal（SAMPLE）主張，期刊應該在人工審查開始前，讓 AI 檢查每一份投稿的證明。",
  ],
  // idea 1
  [
    "Sana Provisional (SAMPLE) argues that reviewers should be told plainly what they may share with AI tools.",
    "Sana Provisional（SAMPLE）主張，應該明確告訴審稿人，他們可以和 AI 工具分享什麼。",
  ],
  // also 0
  [
    "SAMPLE: A model predicts monsoon rainfall weeks ahead",
    "SAMPLE：模型提前數週預測季風降雨",
  ],
  // also 1
  [
    "SAMPLE: A public dataset of ancient inscriptions read with machine help",
    "SAMPLE：機器協助解讀古代銘文的公開資料集",
  ],
  // C-0001 after (explainer.background)
  [
    "A tiling covers a surface with copies of shapes and leaves no gaps. A floor of square tiles repeats one pattern. This proof is about tiles that never do that, on the flat plane only.",
    "鋪磚是把形狀複製許多份，蓋滿一個表面，不留空隙。鋪滿方形磁磚的地板，只重複同一個圖案。這份證明談的是永遠做不到這一點的磁磚，只適用於平面。",
  ],
  // C-0001 reason
  [
    "The paper proves the result for the flat plane only. The first text did not say so, and a reader reported it.",
    "這篇論文只針對平面證明了這項結果。最初的文字沒有這樣說，一位讀者回報了這件事。",
  ],
  // C-0002 after (explainer.how_sure)
  [
    "Applied. The Meridian Weather Service says it runs the model alongside its own system and has not replaced that system. Science published the paper after peer review, and Larch Weather Systems, the maker, helped write it. The tests used past weather only, so live forecasts may differ.",
    "已應用。Meridian Weather Service 表示，它讓這個模型和自己的系統並行運作，並沒有取代原有的系統。Science 在同儕審查後發表了這篇論文，開發者 Larch Weather Systems 也參與撰寫。測試只用了過去的天氣，所以實際預報可能不同。",
  ],
  // C-0002 reason
  [
    "The weather service's statement says the model runs alongside its own system and has not replaced it. The first text said the service relies on the model.",
    "氣象機構的聲明表示，這個模型與它自己的系統並行運作，並沒有取代原有的系統。最初的文字說，這個機構依靠這個模型。",
  ],
  // report decision reason
  [
    "The paper proves the result for the plane only. The first text did not say so, so we wrote a clarification.",
    "這篇論文只針對平面證明了這項結果。最初的文字沒有這樣說，所以我們寫了一則澄清說明。",
  ],

  // ── sunday brief ──
  // lead 0
  [
    "A university says its AI drafted a Bible translation for a small language group.",
    "一所大學表示，它的 AI 為一個小型語言群體起草了聖經翻譯。",
  ],
  // lead 1
  [
    "Today's deep dive follows an AI-proposed antibiotic from the first ranking to a second lab's tests.",
    "今天的深度報導，追蹤一種由 AI 提出的抗生素，從最初的排名，到第二間實驗室的測試。",
  ],
  // deep dive paragraph 0
  [
    "Some germs have stopped responding to the drugs that used to kill them. This is called antimicrobial resistance. It makes some infections hard to treat, and doctors need new antibiotics.",
    "有些病菌已經不再對過去能殺死它們的藥物有反應。這稱為抗微生物抗藥性。它讓某些感染難以治療，醫師需要新的抗生素。",
  ],
  // deep dive paragraph 1
  [
    "Finding a new antibiotic has always been slow. A lab can make and test only a few molecules, and the list of molecules that might work is huge. That is where the AI model came in.",
    "尋找新抗生素向來很慢。一間實驗室只能製作和測試少數幾個分子，而可能有效的分子清單卻非常龐大。這就是 AI 模型派上用場的地方。",
  ],
  // deep dive paragraph 2
  [
    "Halden Research built an AI model called Halden Design. Its paper says the model ranked about 12 million molecules for their chance of killing drug-resistant bacteria. The ranking gave the lab a short list to work from. A ranking is a guess, and it only becomes a finding when someone makes the molecule and tests it.",
    "Halden Research 開發了一個名為 Halden Design 的 AI 模型。它的論文說，這個模型依據殺死抗藥性細菌的機率，為大約 1,200 萬個分子排出名次。這個排名給了實驗室一份可以著手的短名單。排名只是猜測，要有人製作這個分子並測試它，才會成為發現。",
  ],
  // deep dive paragraph 3
  [
    "People took over from there. They made 40 of the top molecules and tested them. Three of the 40 stopped the growth of drug-resistant bacteria in dishes. The best of these cleared a drug-resistant skin infection in 8 of 10 mice.",
    "接下來由人類接手。他們製作了名次最前面的 40 個分子，並測試它們。這 40 個當中有 3 個，在培養皿中阻止了抗藥性細菌生長。其中最好的一個，在 10 隻小鼠中的 8 隻清除了抗藥性皮膚感染。",
  ],
  // deep dive paragraph 4
  [
    "The Coldwater Institute says its team ran the tests in mice. It also runs a first safety trial in people. The trial plans to enrol 24 healthy volunteers. It tests safety, not cure, so it cannot yet tell us whether the compound treats an infection.",
    "Coldwater Institute 表示，它的團隊執行了小鼠實驗。它也在進行第一項人體安全性試驗。這項試驗預計招募 24 名健康志願者。它測試的是安全性，不是治癒，所以還不能告訴我們這個化合物是否能治療感染。",
  ],
  // deep dive paragraph 5
  [
    "So who did what? The AI model proposed which molecules to make. People made them, ran every test and judged the results.",
    "那麼，誰做了什麼？AI 模型提出要製作哪些分子。人類製作這些分子、執行每一項測試，並判斷結果。",
  ],
  // deep dive paragraph 6
  [
    "How sure are we? At first the record was one paper. Cell published it after peer review, so we marked it Checked. But Halden Research, which built the model, helped write the paper, and no other lab had repeated the tests. Our ladder has five steps, and a claim moves up only when the record earns it.",
    "我們有多確定？起初，紀錄只有一篇論文。Cell 在同儕審查後發表了它，所以我們把它標為已查核。但開發這個模型的 Halden Research 也參與撰寫論文，而且沒有其他實驗室重複過這些實驗。我們的查證階梯有五階，只有當紀錄足以支持時，主張才會往上移。",
  ],
  // deep dive paragraph 7
  [
    "That changed this week. A second lab, at Kestrel College, repeated the mouse tests with its own mice and its own samples of the compound. Cell Reports Medicine published its paper. The compound cleared the infection in 7 of 10 mice, close to the 8 of 10 that the first team reported. The lab says it has no tie to Halden Research.",
    "這一點在本週有了變化。Kestrel College 的第二間實驗室，用自己的小鼠和自己的化合物樣本，重複了小鼠實驗。Cell Reports Medicine 發表了它的論文。這個化合物在 10 隻小鼠中的 7 隻清除了感染，接近第一個團隊報告的 10 隻中的 8 隻。這間實驗室表示，它和 Halden Research 沒有關聯。",
  ],
  // deep dive paragraph 8
  [
    "A matching result from a lab with no tie to the first team is what moves a claim up our ladder. The record now stands at Confirmed. It is still a result in mice.",
    "一間與第一個團隊沒有關聯的實驗室，得到相符的結果，正是讓主張沿著我們的查證階梯往上移的原因。這筆紀錄現在處於已證實的階段。這仍然是小鼠身上的結果。",
  ],
  // deep dive paragraph 9
  [
    "For this tracker, the order of events matters. The AI model made its proposals first, and people tested them afterwards. That order is what lets us say the AI helped, and it is what a second lab could check.",
    "對這個追蹤站來說，事情發生的順序很重要。AI 模型先提出建議，人類隨後才測試。這個順序讓我們能說 AI 有幫上忙，也是第二間實驗室能檢查的地方。",
  ],
  // deep dive paragraph 10
  [
    "Much is still open. Mice are not people, so a compound that works in mice may not work in a person. The safety trial has only begun. If it goes well, later trials could test whether the compound treats infections. It might also show that AI can find other new antibiotics, but that would take more cases. Other labs could test those cases, and their results would tell us how far the method reaches.",
    "還有很多問題沒有答案。小鼠不是人，所以在小鼠身上有效的化合物，在人身上不一定有效。安全性試驗才剛開始。如果順利，後續試驗可能測試這個化合物是否能治療感染。它也可能顯示 AI 能找到其他新抗生素，但這需要更多案例。其他實驗室可能測試那些案例，它們的結果會告訴我們這個方法能走多遠。",
  ],

  // ── monday brief ──
  // lead 0
  [
    "An AI controller kept a hot gas steady in a fusion test machine for longer than the standard controller.",
    "AI 控制器在核融合實驗裝置中，讓高溫氣體保持穩定的時間，比標準控制器更久。",
  ],
  // lead 1
  [
    "Last week's review picks out the AI antibiotic and weighs it against a journal setback and a retracted paper.",
    "上週回顧挑出 AI 提出的抗生素，並把它和一次期刊挫折、一篇被撤稿的論文放在一起衡量。",
  ],
  // big picture paragraph 0
  [
    "The week mixed progress with warnings. The clearest progress came where someone other than the makers tested a result. A proof about tiles was read and checked by two mathematicians who were not on the paper.",
    "這一週有進展，也有警訊。最明確的進展，出現在製作者以外的人測試結果的地方。一份關於磁磚的證明，由兩位沒有參與論文的數學家閱讀並檢查過。",
  ],
  // big picture paragraph 1
  [
    "The week's largest result involved no AI at all. Two mathematicians proved that tiles of one kind can fill a flat surface only in patterns that never repeat. We list it because a result of that size should never be missed, and we say plainly that no AI role is known.",
    "這一週最大的成果，完全沒有牽涉 AI。兩位數學家證明，同一種磁磚鋪滿平面時，只能排出永不重複的圖案。我們把它列出來，是因為這麼大的成果不應該被漏掉，而且我們明白說出，目前不知道 AI 有任何角色。",
  ],
  // big picture paragraph 2
  [
    "Where AI did play a part, the stage of the evidence varied. A new weather model beat the standard method in tests on past weather, but the tests were the maker's own. A robotic lab found a cheap metal mixture that splits water, but in one lab so far. An AI model proposed an antibiotic that cleared an infection in mice, and the first safety trial in people has only begun. In each case we mark how sure we are and who says so.",
    "在 AI 確實發揮作用的地方，證據所處的階段各不相同。一個新的天氣模型在過去天氣的測試中勝過標準方法，但測試是開發者自己做的。一間機器人實驗室找到能分解水的廉價金屬混合物，但目前只在一間實驗室裡做過。一個 AI 模型提出了一種抗生素，在小鼠身上清除了感染，而第一項人體安全性試驗才剛開始。在每個案例中，我們都標示我們有多確定，以及是誰這麼說。",
  ],
  // big picture paragraph 3
  [
    "The week also held harm. A journal found that reviewers had pasted unpublished papers into a public chatbot. A paper from a robot lab on a magnetic material was retracted after its authors found errors in the raw data. The second case matters most to this tracker, because AI helped make the first claim and the claim did not stand.",
    "這一週也出現了傷害。一本期刊發現，審稿人把未發表的論文貼進公開的聊天機器人。一間機器人實驗室發表的磁性材料論文，在作者發現原始資料有錯誤後被撤稿。第二個案例對這個追蹤站最重要，因為最初的主張是 AI 協助做出的，而它並沒有站住腳。",
  ],
  // big picture paragraph 4
  [
    "Two items were about the rules and tools around the science. A research council proposed that applicants say whether AI helped write a proposal. A lab released a large set of AI-run survey interviews that other researchers can study.",
    "有兩則報導談的是科學研究相關的規則和工具。一個研究委員會提議，申請人要說明 AI 是否協助撰寫了申請書。一間實驗室公開了大量由 AI 進行的調查訪談，其他研究者可以拿來研究。",
  ],
  // big picture paragraph 5
  [
    "Our reading is cautious. The best evidence came from checks by people outside the team that made the claim. The weakest came from claims that rest on one lab. This week we will watch whether other labs repeat the antibiotic tests and what the research council decides.",
    "我們的解讀很謹慎。最好的證據，來自提出主張的團隊以外的人所做的檢查。最弱的證據，來自只靠一間實驗室的說法。本週我們會留意，其他實驗室是否重複抗生素實驗，以及研究委員會會做出什麼決定。",
  ],
  // remarkable
  [
    "An AI model proposed a new antibiotic that cleared a drug-resistant infection in mice. People made and tested every molecule, and the first safety trial in people has begun.",
    "AI 模型提出一種新抗生素，在小鼠身上清除了抗藥性感染。每個分子都由人類製作和測試，第一項人體安全性試驗已經開始。",
  ],
  // strongest against
  [
    "Reviewers at the journal Sample Review pasted unpublished manuscripts into a public AI chatbot. A robot lab's paper on a magnetic material, planned by an AI, was retracted after the authors found errors in the raw data.",
    "期刊 Sample Review 的審稿人，把未發表的稿件貼進公開的 AI 聊天機器人。一間機器人實驗室的磁性材料論文（研究由 AI 規劃），在作者發現原始資料有誤後被撤稿。",
  ],

  // ── monday-short brief ──
  // lead 0
  [
    "Nothing cleared our bar today, and last week was quiet too.",
    "今天沒有任何發現達到我們的門檻，上週也一樣平靜。",
  ],
  // big picture
  [
    "Last week was quiet. No finding cleared our bar, so there is no result to review and none to single out. The record is still short, and we would rather say so than pad this page. A quiet week is not evidence for or against the hope that AI is speeding up discovery. We keep reading the sources every morning and will report a result as soon as one clears the bar.",
    "上週很平靜。沒有任何發現達到我們的門檻，所以沒有可以回顧的成果，也沒有特別挑出的成果。紀錄仍然很短，我們寧可明說，也不拿內容來湊滿這一頁。平靜的一週，並不是支持或反對「AI 正在加速發現」這個期望的證據。我們每天早上繼續閱讀這些來源，一旦有成果達到門檻，就會立刻報導。",
  ],
];

// ── The lookup ───────────────────────────────────────────────────────────────────────────────────

const TABLE: ReadonlyMap<string, string> = (() => {
  const table = new Map<string, string>();
  for (const [en, zh] of PAIRS) {
    if (table.has(en)) throw new Error(`world-zh.ts translates one English string twice: ${JSON.stringify(en.slice(0, 60))}`);
    table.set(en, zh);
  }
  return table;
})();

/** Every English string the table translates, in table order; a paragraph of a long text is one string. */
export const ZH_ENGLISH: readonly string[] = PAIRS.map(([en]) => en);

const PARAGRAPH_BREAK = "\n\n";

/** Whether `zhText()` has Chinese for `en`: the string itself, or each paragraph of a text of several. */
export function hasZhText(en: string): boolean {
  return TABLE.has(en) || (en.includes(PARAGRAPH_BREAK) && en.split(PARAGRAPH_BREAK).every((p) => TABLE.has(p)));
}

/**
 * The Chinese of an English sample string: its own pair, or, for a text of several paragraphs (a deep dive, a big picture), the
 * Chinese of each paragraph joined by the same blank line. Throws for a string the table lacks, so a changed sample sentence
 * cannot keep an old translation.
 */
export function zhText(en: string): string {
  const whole = TABLE.get(en);
  if (whole !== undefined) return whole;
  if (en.includes(PARAGRAPH_BREAK)) return en.split(PARAGRAPH_BREAK).map((p) => zhText(p)).join(PARAGRAPH_BREAK);
  throw new Error(`world-zh.ts has no Chinese for this sample string: ${JSON.stringify(en.length > 80 ? `${en.slice(0, 80)}...` : en)}`);
}

/** An English sample string with its Chinese, as an `L10n` stores them. */
export const zhL10n = (en: string): L10n => ({ en, zh: zhText(en) });

/**
 * A copy of a stored finding with every null `zh` filled from the table: the title, each explainer part, each rung note and
 * `since_then` text, and the figure's alt text. A value that already has Chinese (a script's bilingual note) is kept as it is. This
 * is how the sample content gets a finding the Chinese pass has translated. Throws for an English text the table lacks.
 */
export function findingWithZh(finding: Finding): Finding {
  const fill = (v: L10n): L10n => (v.zh === null ? { en: v.en, zh: zhText(v.en) } : { ...v });
  const e = finding.explainer;
  return {
    ...structuredClone(finding),
    title: fill(finding.title),
    explainer: {
      found: fill(e.found),
      matters: fill(e.matters),
      ai_helped: e.ai_helped === null ? null : fill(e.ai_helped),
      how_sure: fill(e.how_sure),
      background: fill(e.background),
      could_lead: fill(e.could_lead),
    },
    rung_history: finding.rung_history.map((r) => ({ ...structuredClone(r), note: r.note === null ? null : fill(r.note) })),
    since_then: finding.since_then.map((s) => ({ ...structuredClone(s), text: fill(s.text) })),
    figure: finding.figure === null ? null : { ...structuredClone(finding.figure), alt: fill(finding.figure.alt) },
  };
}

// ── Glossary terms ───────────────────────────────────────────────────────────────────────────────

/**
 * What a glossary term's Chinese side holds besides its definition (which the table translates): the term as everyday Taiwan
 * usage writes it, and the entry 樂詞網 shows when the pass found one. `official` and `official_url` are both null or both set.
 */
export interface ZhTermRecord {
  readonly zh: string;
  readonly official: string | null;
  readonly official_url: string | null;
}

/** The addresses of the three 樂詞網 entries the pass is said to have found. They are invented (`ut-sample-NNNN`) and never fetched. */
const NAER = "https://terms.naer.edu.tw/detail";

/**
 * The seven terms of the sample world, by term id (SPEC §4.3: the English term in kebab case), sorted as the glossary is. Four have
 * no 樂詞網 entry (their `official` and `official_url` are null), so the pass writes the term and its definition and nothing more.
 */
export const ZH_TERM_TABLE: Readonly<Record<string, ZhTermRecord>> = {
  "antimicrobial-resistance": { zh: "抗微生物抗藥性", official: "抗微生物抗藥性", official_url: `${NAER}/ut-sample-0101/` },
  "cryo-electron-microscopy": { zh: "冷凍電子顯微鏡", official: null, official_url: null },
  "numerical-weather-prediction": { zh: "數值天氣預報", official: "數值天氣預報", official_url: `${NAER}/ut-sample-0102/` },
  papyrus: { zh: "莎草紙", official: null, official_url: null },
  plasma: { zh: "電漿", official: "電漿", official_url: `${NAER}/ut-sample-0103/` },
  "proof-assistant": { zh: "證明輔助工具", official: null, official_url: null },
  "virtual-unwrapping": { zh: "虛擬展開", official: null, official_url: null },
};

/** A copy of a glossary term with its Chinese side from the table (a term that already has one is kept); throws for an id the table lacks. */
export function termWithZh(term: Term): Term {
  if (term.zh !== null) return structuredClone(term);
  const record = ZH_TERM_TABLE[term.id];
  if (record === undefined) throw new Error(`world-zh.ts has no Chinese for the glossary term ${term.id}`);
  return {
    ...structuredClone(term),
    zh: { term: record.zh, definition: zhText(term.en.definition), official: record.official, official_url: record.official_url },
  };
}

/** A copy of a glossary with every term's Chinese side filled from the table. */
export function glossaryWithZh(glossary: GlossaryFile): GlossaryFile {
  return { ...structuredClone(glossary), terms: glossary.terms.map(termWithZh) };
}
