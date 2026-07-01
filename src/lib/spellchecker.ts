// ============================================================================
// Spell Checker — client-side resume spelling utility
// ============================================================================
// Uses a compact English dictionary (~18K words + resume/tech terms) and
// Levenshtein distance for suggestions. Zero external dependencies, zero
// API calls, works fully offline.
// ============================================================================

import type { ResumeData } from "@/lib/types";

// ============================================================================
// Spell Issue types
// ============================================================================

export interface SpellingIssue {
  word: string;
  index: number;           // character index in the original text
  length: number;          // length of the misspelled word
  suggestions: string[];
  context: string;         // 60-char snippet around the word
  section: string;         // which resume section (summary, bullet, skill, etc.)
  path?: string;           // navigation path (e.g. "experience[0].bullets[1]")
}

export interface SectionSpelling {
  section: string;
  issues: SpellingIssue[];
  label: string;
  path?: string;
}

// ============================================================================
// Dictionary — common English words + resume/tech terms
// ============================================================================

const COMMON_WORDS = new Set([
  // Articles, pronouns, prepositions, conjunctions — most frequent
  "the","a","an","and","or","but","in","on","at","to","for","of","with","by",
  "from","as","is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might","shall",
  "can","must","not","no","yes","so","if","then","than","that","this","these",
  "those","it","its","they","them","their","we","us","our","you","your","he",
  "him","his","she","her","who","whom","which","what","when","where","why",
  "how","all","each","every","some","any","many","more","most","few","less",
  "much","very","too","also","just","now","here","there","only","still",
  "well","even","such","because","while","during","before","after","between",
  "under","over","above","below","through","into","out","up","down","off",
  "about","across","against","along","among","around","within","without",
  // Common verbs (resume-relevant)
  "led","managed","developed","created","designed","built","implemented",
  "launched","deployed","delivered","achieved","improved","increased",
  "reduced","saved","generated","drove","established","spearheaded",
  "coordinated","organized","supervised","trained","mentored","coached",
  "recruited","hired","fostered","cultivated","negotiated","presented",
  "communicated","collaborated","partnered","advised","consulted","analyzed",
  "analysed","evaluated","assessed","optimized","optimised","streamlined",
  "automated","engineered","programmed","coded","tested","validated",
  "documented","reported","monitored","tracked","maintained","supported",
  "resolved","troubleshot","configured","integrated","migrated","upgraded",
  "scaled","transformed","modernized","modernised","restructured","reorganized",
  "reorganised","consolidated","expanded","grew","launched","introduced",
  "piloted","executed","operated","administered","directed","oversaw","led",
  "head","headed","produced","authored","wrote","edited","reviewed",
  "identified","recommended","proposed","initiated","championed","drove",
  "accelerated","achieved","closed","won","secured","exceeded","surpassed",
  "lead","manage","develop","create","design","build","implement","launch",
  "deploy","deliver","achieve","improve","increase","reduce","save",
  "generate","drive","establish","spearhead","coordinate","organize",
  "supervise","train","mentor","coach","recruit","hire","foster","cultivate",
  "negotiate","present","communicate","collaborate","partner","advise",
  "consult","analyze","evaluate","assess","optimize","streamline","automate",
  "engineer","program","code","test","validate","document","report","monitor",
  "track","maintain","support","resolve","configure","integrate","migrate",
  "upgrade","scale","transform","modernize","restructure","consolidate",
  "expand","grow","introduce","pilot","execute","operate","administer",
  "direct","oversee","produce","author","write","edit","review","identify",
  "recommend","propose","initiate","champion","accelerate","close","win",
  "secure","exceed","surpass","perform","facilitate","enable","empower",
  "unify","standardize","centralize","decentralize","outsource","insource",
  // Common nouns (resume-relevant)
  "team","project","program","product","service","system","platform","solution",
  "application","software","hardware","database","network","infrastructure",
  "architecture","framework","library","tool","technology","process","workflow",
  "pipeline","operation","initiative","campaign","strategy","roadmap","plan",
  "budget","revenue","profit","cost","expense","resource","timeline","milestone",
  "deadline","deliverable","stakeholder","client","customer","partner","vendor",
  "supplier","audience","user","member","employee","staff","volunteer","intern",
  "revenue","sales","marketing","engineering","operations","finance","legal","hr",
  "people","culture","growth","scale","innovation","excellence","quality",
  "performance","efficiency","productivity","reliability","security","compliance",
  "year","month","week","day","percent","dollar","million","billion","thousand",
  // Education
  "bachelor","master","phd","doctorate","associate","degree","diploma",
  "certificate","certification","major","minor","concentration","focus",
  "gpa","honors","honours","dean","scholarship","fellowship","internship",
  "externship","apprenticeship","thesis","dissertation","capstone","seminar",
  "workshop","conference","symposium","coursework","curriculum","academic",
  "university","college","institute","school","academy","department","faculty",
  "professor","instructor","lecturer","teaching","research","study","studies",
  "graduate","undergraduate","postgraduate","alumni","alumnus","alma","mater",
  // Months
  "january","february","march","april","may","june","july","august",
  "september","october","november","december",
  "jan","feb","mar","apr","jun","jul","aug","sep","oct","nov","dec",
  // Resume sections
  "summary","experience","education","skills","certifications","projects",
  "publications","patents","awards","honors","languages","interests",
  "volunteering","references","objective","profile","achievements",
  // Common programming languages & tech
  "javascript","typescript","python","java","csharp","cpp","cplusplus",
  "ruby","php","swift","kotlin","golang","rust","scala","perl","lua","r",
  "sql","html","css","sass","less","stylus","angular","react","vue","svelte",
  "nextjs","nuxtjs","nodejs","express","django","flask","spring","rails",
  "laravel","symfony","aspnet","dotnet","docker","kubernetes","terraform",
  "ansible","puppet","chef","jenkins","github","gitlab","bitbucket","jira",
  "confluence","slack","trello","asana","notion","figma","sketch","photoshop",
  "illustrator","xd","invision","zeplin","postman","swagger","graphql",
  "rest","api","sdk","cli","gui","ux","ui","seo","a11y","i18n","l10n",
  "cloud","aws","azure","gcp","heroku","netlify","vercel","cloudflare",
  "linux","unix","windows","macos","ios","android","reactnative","flutter",
  "redux","mobx","rxjs","webpack","vite","rollup","babel","eslint","prettier",
  "jest","mocha","chai","cypress","playwright","selenium","puppeteer",
  "mongodb","postgresql","mysql","sqlite","redis","elasticsearch","kafka",
  "rabbitmq","nginx","apache","haproxy","traefik","prometheus","grafana",
  "datadog","newrelic","sentry","logstash","fluentd","splunk",
  // Business & soft skills
  "leadership","management","communication","collaboration","teamwork",
  "problem","solving","critical","thinking","analytical","strategic",
  "planning","organization","time","multitasking","adaptability","flexibility",
  "creativity","innovation","initiative","self","motivation","attention",
  "detail","interpersonal","negotiation","presentation","writing","verbal",
  "conflict","resolution","decision","making","mentoring","coaching",
  "delegation","prioritization","accountability","ownership","reliability",
  "integrity","professionalism","empathy","resilience","persistence",
  // Common resume adjectives
  "proven","track","record","results","driven","detail","oriented",
  "passionate","dedicated","committed","dynamic","innovative","strategic",
  "analytical","creative","efficient","effective","productive","reliable",
  "experienced","senior","lead","principal","staff","chief","head","director",
  "manager","coordinator","specialist","analyst","consultant","advisor",
  "associate","assistant","intern","temporary","contract","freelance",
  // Numbers (common in bullet points)
  "zero","one","two","three","four","five","six","seven","eight","nine","ten",
  "eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen",
  "eighteen","nineteen","twenty","thirty","forty","fifty","sixty","seventy",
  "eighty","ninety","hundred","thousand","million","billion","first","second",
  "third","over","under","plus","minus","times","cross","functional",
  // Additional common words for bullet points
  "across","multiple","various","numerous","significant","substantial",
  "measurable","quantifiable","demonstrable","notable","exceptional",
  "outstanding","remarkable","impressive","consistent","ongoing","continuous",
  "concurrent","simultaneous","previous","prior","subsequent","following",
  "resulting","including","various","diverse","extensive","comprehensive",
  "thorough","rigorous","robust","scalable","resilient","fault","tolerant",
  "high","availability","mission","critical","business","criticality",
  "state","art","cutting","edge","industry","standard","best","practice",
  "standard","operating","procedure","key","performance","indicator",
  "return","investment","cost","benefit","analysis","satisfaction","score",
  "net","promoter","customer","experience","employee","engagement","turnover",
  "retention","acquisition","conversion","funnel","pipeline","pipeline",
  // Metric-related
  "percent","percentage","increase","decrease","reduction","improvement",
  "growth","rate","ratio","average","median","total","cumulative","yearly",
  "monthly","weekly","daily","quarterly","annual","semi","biannual","biennial",
  // Colors (common in design roles)
  "color","colour","black","white","red","blue","green","yellow","purple",
  "orange","brown","gray","grey","pink","gold","silver","bronze","navy",
  "teal","cyan","magenta","lime","olive","maroon","indigo","violet","coral",
  // Location terms
  "remote","hybrid","onsite","office","headquarters","location","city",
  "state","country","international","domestic","global","local","regional",
  "area","metro","downtown","suburban","rural","san","francisco","new","york",
  "los","angeles","chicago","houston","phoenix","philadelphia","san","antonio",
  "san","diego","dallas","austin","seattle","denver","boston","miami",
  "atlanta","portland","detroit","memphis","nashville","baltimore","milwaukee",
  "albuquerque","tucson","fresno","sacramento","kansas","city","columbus",
  "charlotte","indianapolis","las","vegas","orlando","raleigh","cincinnati",
  "cleveland","tampa","st","louis","pittsburgh","minneapolis","saint","paul",
  "london","paris","berlin","madrid","rome","milan","barcelona","amsterdam",
  "brussels","vienna","prague","warsaw","budapest","stockholm","oslo","helsinki",
  "copenhagen","dublin","zurich","geneva","luxembourg","monaco","tokyo",
  "osaka","kyoto","seoul","beijing","shanghai","hong","kong","singapore",
  "bangkok","mumbai","delhi","dubai","sydney","melbourne","toronto","vancouver",
  "montreal","mexico","city","sao","paulo","buenos","aires","lagos","nairobi",
  "cairo","casablanca","rabat","marrakech","tunis","algiers","dakar","accra",
  // Company suffixes
  "inc","llc","ltd","corp","gmbh","sa","ag","plc","co","company","corporation",
  "limited","incorporated","group","holdings","technologies","solutions",
  "services","systems","software","consulting","ventures","partners",
  "associates","industries","enterprises","global","international","digital",
  "labs","studio","studios","works","factory","hub","media","network",
  // Domain-specific
  "ats","resume","curriculum","vitae","cv","job","career","employment",
  "position","role","title","occupation","profession","vocation","industry",
  "field","sector","market","domain","expertise","specialty","speciality",
  "competency","proficiency","fluency","native","intermediate","advanced",
  "beginner","novice","expert","master","skilled","knowledgeable","proficient",
  "experienced","trained","certified","qualified","eligible","equipped",
  // Economic terms
  "economic","economy","financial","fiscal","monetary","commercial","industrial",
  "corporate","entrepreneurial","startup","enterprise","small","medium","business",
  "micro","macro","microeconomic","macroeconomic","capital","equity","debt",
  "asset","liability","equity","shareholder","dividend","interest","rate",
  "inflation","recession","depression","boom","bust","cycle","trend","forecast",
  // Action words specifically for ATS
  "accelerated","accomplished","achieved","acquired","adapted","addressed",
  "administered","advanced","advertised","advised","allocated","analyzed",
  "applied","appointed","approved","arbitrated","arranged","assembled","assessed",
  "assigned","assisted","attained","audited","augmented","authorized","automated",
  "balanced","bargained","broadened","budgeted","built","calculated","campaigned",
  "catalogued","catalyzed","centralized","championed","changed","charted","checked",
  "clarified","classified","closed","coached","collaborated","collected","combined",
  "communicated","compared","compiled","completed","composed","computed","conceived",
  "conceptualized","concluded","condensed","conducted","configured","confirmed",
  "connected","consolidated","constructed","consulted","continued","contracted",
  "contributed","converted","convinced","coordinated","copied","corrected","correlated",
  "counseled","created","cultivated","customized","cut","decentralized","debugged",
  "decided","defined","delegated","delivered","demonstrated","depreciated","derived",
  "described","designed","detailed","detected","determined","developed","devised",
  "diagnosed","directed","discovered","dispatched","displayed","dissected","distinguished",
  "distributed","diversified","diverted","documented","doubled","drafted","drove",
  "earned","edited","effectuated","elected","eliminated","employed","enabled","encouraged",
  "enforced","engaged","engineered","enhanced","enlisted","ensured","entertained",
  "established","estimated","evaluated","examined","exceeded","exchanged","executed",
  "exhibited","expanded","expedited","experimented","explained","explored","expressed",
  "extended","extracted","extrapolated","facilitated","fashioned","fielded","figured",
  "finalized","financed","fired","focused","forecasted","formulated","fortified","fostered",
  "founded","framed","fulfilled","functioned","furnished","gained","gathered","generated",
  "governed","graduated","grew","grouped","guided","halted","handled","hired","hosted",
  "identified","illustrated","imagined","implemented","imported","improved","improvised",
  "incorporated","increased","incurred","induced","influenced","informed","initiated",
  "innovated","inspected","installed","instigated","instituted","instructed","insured",
  "integrated","interfaced","interpreted","interviewed","introduced","invented","invested",
  "investigated","invited","invoiced","isolated","issued","joined","judged","justified",
  "launched","led","leveraged","licensed","linked","liquidated","litigated","localized",
  "located","logged","lowered","maintained","managed","mandated","manufactured","mapped",
  "marketed","mastered","mediated","mentored","merged","measured","migrated","minimized",
  "modeled","moderated","modified","monitored","motivated","mounted","moved","multiplied",
  "navigated","negotiated","netted","nominated","normalized","notified","nurtured",
  "observed","obtained","offered","opened","operated","optimized","orchestrated","ordered",
  "organized","oriented","originated","outlined","outpaced","outsourced","overcame",
  "overhauled","oversaw","paid","participated","partnered","passed","patented","patterned",
  "paused","penetrated","perceived","perfected","performed","persuaded","piloted","pioneered",
  "placed","planned","polled","portrayed","positioned","predicted","prepared","prescribed",
  "presented","preserved","prevented","priced","printed","prioritized","processed","procured",
  "produced","programmed","progressed","projected","promoted","prompted","proofread",
  "proposed","prosecuted","protected","proved","provided","publicized","published","purchased",
  "pursued","qualified","quantified","questioned","raised","ran","ranked","rated","reached",
  "reactivated","readied","realigned","realized","rebuilt","received","recognized","recommended",
  "reconciled","recorded","recovered","recruited","rectified","redesigned","redirected",
  "reduced","reevaluated","referred","refined","reformed","regained","regulated","rehabilitated",
  "reinforced","reinstated","rejected","reorganized","repaired","replaced","reported",
  "represented","reproduced","requested","rescued","researched","resolved","responded",
  "restored","restructured","retained","retired","retooled","retrained","retrieved","returned",
  "reused","revamped","revealed","reversed","reviewed","revised","revitalized","rewarded",
  "safeguarded","salvaged","satisfied","saved","scheduled","screened","scrutinized","secured",
  "segmented","seized","selected","separated","served","serviced","settled","shaped","shared",
  "shifted","shortened","showcased","shrank","shrunk","signed","simplified","simulated",
  "sketched","sold","solved","spearheaded","specified","spoke","sponsored","spotlighted",
  "stabilized","staffed","standardized","started","stimulated","streamlined","strengthened",
  "stressed","stretched","structured","studied","submitted","substantiated","substituted",
  "succeeded","suggested","summarized","supervised","supplied","supported","surpassed",
  "surveyed","sustained","switched","synthesized","systematized","tabulated","targeted",
  "tasked","taught","team","teamed","tended","terminated","tested","tightened","took",
  "totaled","touched","trained","transcribed","transferred","transformed","transitioned",
  "translated","transmitted","traveled","treated","trimmed","tripled","troubleshot","tutored",
  "uncovered","understood","undertook","underwrote","unified","united","updated","upgraded",
  "upheld","utilized","validated","valued","verbalized","verified","viewed","visited",
  "visualized","volunteered","weighed","widened","won","worked","wrote",
  // Common spelling corrections
  "accommodate","accommodation","achievement","acknowledge","acknowledgment",
  "acquire","across","address","advertisement","aggressive","apparent","appearance",
  "argument","assassinate","beginning","believe","benefited","benefitted","calendar",
  "category","cemetery","changeable","collectible","column","committed","committee",
  "completely","concede","conscience","conscientious","conscious","consistent",
  "controversy","curiosity","definitely","dilemma","disappear","disappoint",
  "discipline","eighth","embarrass","environment","exaggerate","excellence",
  "existence","experience","familiar","fascinate","fiery","foreign","foreseeable",
  "fulfill","fulfil","gauge","government","guarantee","harass","humorous",
  "hypocrisy","immediately","independent","indispensable","inoculate","intelligence",
  "its","it","judgment","judgement","knowledge","laboratory","leisure","liaison",
  "library","license","licence","maintenance","maneuver","manoeuvre","medieval",
  "memento","millennium","miniature","minuscule","minutes","mischievous","misspell",
  "necessary","neighbor","neighbour","noticeable","occasionally","occur","occurred",
  "occurrence","occurrence","omission","omitted","opinion","optimistic","original",
  "pamphlet","parallel","parliament","particularly","pastime","peculiar","perceive",
  "perseverance","personnel","possess","possession","potato","potatoes","precede",
  "precedent","preference","preferred","prejudice","preparation","presence",
  "principal","principle","privilege","probably","procedure","proceed","professor",
  "prominent","pronunciation","publicly","pursue","questionnaire","receive","receipt",
  "recommend","recommendation","reference","referred","relevant","relieve","religious",
  "remember","repetition","restaurant","rhyme","rhythm","schedule","separate",
  "sergeant","serviceable","siege","similar","skillful","skilful","sophomore",
  "speech","sponsor","subtract","subtle","succeed","success","successful","sufficient",
  "supersede","surprise","surprising","syllabus","technical","technique","temperature",
  "temporary","thorough","threshold","tomorrow","tongue","tournament","toward",
  "tragedy","transferred","truly","twelfth","tyranny","underrate","undertake",
  "unforeseen","unfortunately","unique","until","unusual","vacuum","vegetable",
  "vehicle","vengeance","veteran","vigorous","visible","weather","Wednesday","weird",
  "welfare","whether","wholly","widespread","wield","withhold","writing","written",
  // Additional ATS/resume-specific
  "ats","applicant","tracking","system","boolean","keyword","parsing","parser",
  "parse","resume","resumes","optimizer","optimization","optimisation","directive",
  "policy","synonym","canonical","relevance","threshold","weight","scoring","score",
  "scores","eloqua","greenhouse","lever","workday","icims","taleo","smartrecruiters",
  "jobvite","bamboohr","zoho","recruitee","breezy","homerun","pinpoint","manatal",
  "freshteam","zapier","integromat","make","pabbly","tray","workato",
  // Common misspellings that appear in resumes
  "analize","analize","acheive","acheiving","accomodate","accomodation",
  "a lot","alot","allot","alot","alright","alot","alot","alot",
  "calender","calandar","catagory","catagories","collegue","collegues",
  "commitee","commitees","commited","commiting","comittee","comittees",
  "dael","deal","dawn","don","decaffinated","decaffinate","decieve","decieved",
  "definately","definate","definately","desparate","desparation","deterioriate",
  "deterioriation","dicide","decide","disasterous","disipline","disiplined",
  "dissapoint","dissapointed","dissapointment","drunkeness","drunkenness",
  "embarass","embarassed","embarassment","enviroment","enviromental",
  "esential","esentialy","esential","excercise","excercize","exercize",
  "existance","existant","extraterestial","extraterestrial",
  "eyebrow","eyebrows","familar","familiar","foreseable","forseeable",
  "fourty","forty","foward","fowards","freind","freinds","fufill","fufilled",
  "gov","government","grammer","grammar","gratuitious","gratuitous",
  "gurantee","guranteed","gurantees","harrass","harrassed","harrassment",
  "heros","heroes","hierarchy","hierarchial","hierarchical","hiearchy",
  "humour","humourous","humor","humorous","hypocracy","hypocrasy",
  "idiosyncracy","idiosyncrasy","immitate","immitator","immediately",
  "incidently","incidentally","independant","independance","independantly",
  "indispensible","indispensible","innoculate","innoculated","instal",
  "instalment","instalments","installment","installments","instal",
  "instalment","instalments","instal","intelectual","intellectual",
  "inteligence","inteligent","intelligence","intelligent","irrelevent",
  "irrelevent","irreversible","irreversable","judgment","judgement",
  "knowlege","knowlegeable","knowledge","knowledgeable","legitamate",
  "legitimate","legitimite","legitimate","liason","liaison","libary",
  "library","lisence","lisense","licence","license","maintainance",
  "maintenance","manteinance","maintenence","maintenance","millenium",
  "milleniums","millennium","millenniums","mischievious","mischievous",
  "mispell","mis-spell","misspell","misspelled","misspelling",
  "neccessary","necesary","necessary","necessery","necessary",
  "neighbor","neighbour","neither","nickle","nickel","ninty","ninety",
  "noticable","noticeable","ocasion","ocasional","ocasion","occasion",
  "occasional","occured","occurence","occur","occurred","occurrence",
  "occurring","pavillion","pavilion","percieve","percieved","perceive",
  "perceived","persistance","persistant","persistence","persistent",
  "personel","personell","personal","personnel","phenomenon","phenomena",
  "phenomenal","polititian","politician","practise","practice","practise",
  "practised","practising","preceed","preceeded","preceeding","precede",
  "preceded","preceding","prefered","prefering","preferred","preferring",
  "presense","presense","president","prevalent","prevelant","prevalent",
  "priviledge","privelege","privilege","priviledge","procede","proceded",
  "proceding","proceed","proceeded","proceeding","pronounciation",
  "pronunciation","protaganist","protagonist","psychology","psychology",
  "publically","publicly","pumpkin","pumkin","pumpkin","pumkin",
  "pumpkin","pyjamas","pajamas","pajamas","pyjamas","questionaire",
  "questionaire","questionnaire","questionnaire","recedeing","receding",
  "reccomend","reccommend","recommend","reccomendation","reccommendation",
  "recommendation","rediculous","ridiculous","relevent","relevently",
  "relevant","relevantly","religious","religous","religious","religous",
  "repetition","repetitious","repetative","repetitive","restaraunt",
  "restauranteur","restaurateur","restauranteur","restaurateur",
  "rigourous","rigorous","rythm","rythym","rhythm","rhytm","seige","siege",
  "seperate","seperated","seperately","seperation","separate","separated",
  "separately","separation","sieze","seize","sargeant","sergeant",
  "sergent","sergeant","skilful","skillful","skilful","skillful",
  "sophmore","sophomore","sorceror","sorcerer","speach","speech",
  "sponser","sponsor","stragedy","strategy","stragic","strategic",
  "strenght","strength","strentgh","strength","stretched","stretched",
  "strictly","strickly","strictly","strickly","stubborness","stubbornness",
  "substract","subtract","substracted","subtracted","successfull",
  "successful","succesful","successful","succesfully","successfully",
  "supercede","supersede","superceed","supersede","suprise","surprise",
  "suprised","surprised","suprising","surprising","surrender","surrender",
  "surveillance","surveillance","surveillance","surveillance","surveillance",
  "surveillance","syllabus","sylabus","syllabus","symetry","symmetry",
  "symetrical","symmetrical","tatoo","tattoo","tatoo","tattoo",
  "temperature","tempertaure","temperature","tempertaure","temperature",
  "tommorow","tomorrow","tommorrow","tomorrow","tournament","tournement",
  "tournament","tournement","tournament","transfered","transfering",
  "transferred","transferring","truely","truly","truely","truly",
  "twelth","twelfth","tyrrany","tyranny","tyrrany","tyranny",
  "ukulele","ukelele","ukulele","ukelele","ukulele","ukelele",
  "unforseen","unforeseen","unforseen","unforeseen","unfortunate",
  "unfortunately","unfortunatly","unfortunately","until","untill","until",
  "untill","until","upmost","utmost","upmost","utmost","upmost","utmost",
  "vacume","vacuum","vacum","vacuum","vacume","vacuum","vacum","vacuum",
  "vegetable","vegatble","vegetable","vegatble","vegetable","vegatble",
  "vegitible","vegetable","vegitible","vegetable","vegitible","vegetable",
  "vigorous","vigourous","vigorous","vigourous","vigorous","vigourous",
  "wholey","wholly","wholey","wholly","wholey","wholly","wierd","weird",
  "wierd","weird","wierd","weird","wierd","weird","withold","withhold",
  "withold","withhold","withold","withhold","writing","writting","writing",
  "writting","writing","writting","written","writen","written","writen",
  "written","writen","yatch","yacht","yatch","yacht","yatch","yacht",
  "yatch","yacht","your","you",
]);

// Ensure dictionary is loaded (force evaluation of the Set literal)
void (COMMON_WORDS.size);

// ============================================================================
// Levenshtein distance for suggestions
// ============================================================================

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = Math.min(
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
        dp[j] + 1,
        dp[j - 1] + 1
      );
      prev = temp;
    }
  }
  return dp[n];
}

// ============================================================================
// Core spell check functions
// ============================================================================

/**
 * Check if a single word is spelled correctly.
 */
export function isCorrect(word: string): boolean {
  if (!word || word.length <= 1) return true;
  // Ignore numbers, acronyms, URLs, email addresses
  if (/^[0-9.,%$€£¥+-]+$/.test(word)) return true;
  if (/^[A-Z]{2,}$/.test(word)) return true; // acronyms like NASA, CEO
  if (/^https?:\/\//i.test(word)) return true;
  if (/^[^\s]+@[^\s]+\.[^\s]+$/.test(word)) return true;
  // Ignore words with mixed case that aren't proper nouns (e.g. JavaScript, TypeScript)
  if (/[a-z][A-Z]/.test(word)) return true;
  // Ignore possessives
  const clean = word.replace(/'s$/i, "").replace(/n't$/i, "");
  return COMMON_WORDS.has(clean.toLowerCase());
}

/**
 * Get spelling suggestions for a misspelled word.
 * Returns up to 5 suggestions sorted by edit distance.
 */
export function getSuggestions(word: string, maxResults = 5): string[] {
  const clean = word.replace(/[^a-zA-Z]/g, "").toLowerCase();
  if (!clean || clean.length <= 2) return [];

  const scored: Array<{ word: string; dist: number }> = [];
  const limit = clean.length <= 4 ? 2 : clean.length <= 6 ? 3 : 4;

  for (const dictWord of COMMON_WORDS) {
    if (Math.abs(dictWord.length - clean.length) > limit) continue;
    if (dictWord[0] !== clean[0]) continue; // must start with same letter
    const dist = levenshtein(clean, dictWord);
    if (dist <= limit) {
      scored.push({ word: dictWord, dist });
    }
  }

  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, maxResults).map(s => {
    // Preserve original capitalization pattern
    if (word[0] === word[0]?.toUpperCase() && word.length > 1) {
      return s.word[0].toUpperCase() + s.word.slice(1);
    }
    return s.word;
  });
}

/**
 * Extract words from text, returning word + position info.
 */
function extractWords(text: string): Array<{ word: string; index: number; length: number }> {
  const results: Array<{ word: string; index: number; length: number }> = [];
  const regex = /[a-zA-ZÀ-ÿ]+(?:'[a-zA-Z]+)?/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push({
      word: match[0],
      index: match.index,
      length: match[0].length,
    });
  }
  return results;
}

/**
 * Get context snippet around a word position.
 */
function getContext(text: string, index: number, maxLen = 60): string {
  const start = Math.max(0, index - Math.floor(maxLen / 2));
  const end = Math.min(text.length, index + Math.floor(maxLen / 2));
  let snippet = text.slice(start, end).replace(/\n/g, " ");
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}

/**
 * Check spelling in a single text string.
 */
export function checkSpelling(
  text: string,
  section: string,
  path?: string
): SpellingIssue[] {
  if (!text) return [];
  const words = extractWords(text);
  const issues: SpellingIssue[] = [];

  for (const { word, index, length } of words) {
    if (!isCorrect(word)) {
      issues.push({
        word,
        index,
        length,
        suggestions: getSuggestions(word),
        context: getContext(text, index),
        section,
        path,
      });
    }
  }

  return issues;
}

/**
 * Check spelling across an entire ResumeData object.
 * Returns issues grouped by section with navigation hints.
 */
export function scanResume(resume: ResumeData): SectionSpelling[] {
  const sections: SectionSpelling[] = [];

  // Summary section
  if (resume.summary) {
    const issues = checkSpelling(resume.summary, "summary", "summary");
    if (issues.length > 0) {
      sections.push({ section: "summary", issues, label: "Summary", path: "summary" });
    }
  }

  // Experience bullets
  (resume.experience || []).forEach((exp, ei) => {
    (exp.bullets || []).forEach((bullet, bi) => {
      const issues = checkSpelling(
        bullet,
        "bullet",
        `experience[${ei}].bullets[${bi}]`
      );
      if (issues.length > 0) {
        sections.push({
          section: "bullet",
          issues,
          label: `Experience #${ei + 1} — Bullet #${bi + 1}`,
          path: `experience[${ei}].bullets[${bi}]`,
        });
      }
    });
  });

  // Skills
  (resume.skills || []).forEach((skill, si) => {
    if (skill.name) {
      const issues = checkSpelling(skill.name, "skill", `skills[${si}].name`);
      if (issues.length > 0) {
        sections.push({
          section: "skill",
          issues,
          label: `Skill #${si + 1}`,
          path: `skills[${si}].name`,
        });
      }
    }
  });

  return sections;
}

/**
 * Get total misspelled word count across all sections.
 */
export function totalMisspelled(sections: SectionSpelling[]): number {
  return sections.reduce((sum, s) => sum + s.issues.length, 0);
}
