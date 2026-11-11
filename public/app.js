const HISTORY_KEY = "med-interview-history-v1";
const AUDIO_CAP_MS = 180000;
const DIFFICULTY = { easy: "易", medium: "中", hard: "難" };
const MODE_LABEL = { single: "單題練習", traditional: "短場面試", mmi: "MMI 單站" };

const state = {
  health: null,
  bank: null,
  loadError: "",
  setup: { mode: "single", category: "不限", count: 3 },
  session: null,
  draft: "",
  history: readHistory(),
  viewing: null,
};

const app = document.querySelector("#app");
const media = { recorder: null, stream: null, chunks: [], timer: 0, started: 0, blob: null, mime: "", url: "" };

init();

async function init() {
  window.addEventListener("hashchange", render);
  try {
    const [health, bank] = await Promise.all([
      fetch("/api/health").then(readJson),
      fetch("/api/questions").then(readJson),
    ]);
    state.health = health;
    state.bank = bank;
  } catch (error) {
    state.loadError = error.message || "題庫載入失敗。";
  }
  if (!location.hash) location.hash = "#/";
  render();
}

function render() {
  const route = location.hash || "#/";
  if (!route.startsWith("#/practice")) stopMedia();
  app.replaceChildren();
  const shell = el("main", { class: "shell" }, [topbar(route)]);
  if (state.loadError) shell.append(el("p", { class: "error", role: "alert" }, state.loadError));
  else if (route.startsWith("#/setup")) shell.append(setupView());
  else if (route.startsWith("#/practice")) shell.append(practiceView());
  else if (route.startsWith("#/reflect")) shell.append(reflectView());
  else if (route.startsWith("#/report")) shell.append(reportView(state.session?.report));
  else if (route.startsWith("#/history")) shell.append(historyView());
  else if (route.startsWith("#/privacy")) shell.append(privacyView());
  else shell.append(homeView());
  app.append(shell);
}

function topbar(route) {
  const link = (hash, label) => el("a", { href: hash, ...(route.startsWith(hash) ? { "aria-current": "page" } : {}) }, label);
  return el("header", { class: "top" }, [
    el("a", { class: "brand", href: "#/" }, [
      el("span", { class: "stamp", "aria-hidden": "true" }, "面試"),
      el("span", {}, [el("strong", {}, "醫學系模擬面試"), el("small", {}, "個人申請／繁星二階練習")]),
    ]),
    el("nav", { class: "nav", "aria-label": "主要" }, [link("#/setup", "開始"), link("#/history", "紀錄"), link("#/privacy", "隱私")]),
  ]);
}

function homeView() {
  return el("section", { class: "hero" }, [
    mockBanner(),
    el("div", { class: "card" }, [
      el("p", { class: "kicker" }, "練習，不是預測"),
      el("h1", {}, "把面試當成會被追問的對話"),
      el("p", { class: "lede" }, "給準備台灣醫學系二階的高中生。可練單題、三到五題的短場面試，或一站有閱讀時間的 MMI。"),
      el("p", {}, "面試過程中，教授只會提問，不給提示。結束後才由教練依公開簡章的評分方向寫回饋，並引用你自己說過的話。"),
      el("div", { class: "row" }, [
        el("a", { class: "btn seal", href: "#/setup" }, "開始練習"),
        el("a", { class: "btn secondary", href: "#/privacy" }, "隱私說明"),
      ]),
    ]),
    el("div", { class: "card" }, [
      el("h2", {}, "這次練習會發生什麼"),
      el("ol", {}, [
        el("li", {}, "選模式與題型。題目是依公開考生回憶改寫的，不是各校原題。"),
        el("li", {}, "錄音或改用文字。音檔只在這次請求裡使用，伺服器不保存。"),
        el("li", {}, "教授可能追問一到兩次。含糊會被追，講太滿會被反問。"),
        el("li", {}, "你可以先回答一個反思問題，再看分數、證據與可改的結構。"),
      ]),
      el("p", { class: "muted footer-note" }, state.bank ? `題庫 ${state.bank.questions.length} 題。${state.bank.note}` : ""),
    ]),
  ]);
}

function setupView() {
  const { mode, category, count } = state.setup;
  const categories = ["不限", ...new Set(state.bank.questions.map((question) => question.category))];
  return el("section", { class: "stack" }, [
    mockBanner(),
    el("div", { class: "card stack" }, [
      el("h1", {}, "選擇練習"),
      el("h2", {}, "模式"),
      el("div", { class: "choices" }, [
        modeButton("single", "單題"),
        modeButton("traditional", "短場面試"),
        modeButton("mmi", "MMI 單站"),
      ]),
      el("p", { class: "muted" }, mode === "traditional"
        ? "連續三到五題傳統口試題，每題最多一次追問。"
        : mode === "mmi"
          ? "一站情境。先閱讀，再作答。這題最多一次追問。"
          : "一題，最多兩次追問。若題目是 MMI，仍會先顯示閱讀時間。"),
      mode === "traditional"
        ? el("div", { class: "stack" }, [
          el("h2", {}, "題數"),
          el("div", { class: "choices" }, [3, 4, 5].map((value) => el("button", {
            class: "choice",
            type: "button",
            "aria-pressed": String(count === value),
            onclick: () => { state.setup.count = value; render(); },
          }, `${value} 題`))),
        ])
        : null,
      el("h2", {}, "類別"),
      el("div", { class: "choices" }, categories.map((item) => el("button", {
        class: "choice",
        type: "button",
        "aria-pressed": String(category === item),
        onclick: () => { state.setup.category = item; render(); },
      }, item))),
      el("button", { class: "btn seal", type: "button", onclick: startSession }, "進入面試"),
      state.setup.error ? el("p", { class: "error", role: "alert" }, state.setup.error) : null,
    ]),
  ]);
}

function modeButton(mode, label) {
  return el("button", {
    class: "choice",
    type: "button",
    "aria-pressed": String(state.setup.mode === mode),
    onclick: () => { state.setup.mode = mode; render(); },
  }, label);
}

function startSession() {
  const { mode, category, count } = state.setup;
  let pool = state.bank.questions.filter((question) => category === "不限" || question.category === category);
  if (mode === "traditional") pool = pool.filter((question) => question.format === "traditional");
  if (mode === "mmi") pool = pool.filter((question) => question.format === "mmi");
  const need = mode === "traditional" ? count : 1;
  if (pool.length < need) {
    state.setup.error = mode === "traditional"
      ? "這個類別的傳統題不夠。請改選「不限」，或減少題數。"
      : "這個類別沒有符合模式的題目。";
    render();
    return;
  }
  const questions = shuffle(pool).slice(0, need);
  state.setup.error = "";
  state.session = {
    mode,
    questions,
    index: 0,
    items: questions.map((question) => ({ question, turns: [] })),
    phase: questions[0].format === "mmi" && questions[0].readingSeconds > 0 ? "reading" : "idle",
    readingLeft: questions[0].readingSeconds || 0,
    pending: null,
    error: "",
    reflectionQuestion: "",
    reflectionAnswer: "",
    report: null,
  };
  location.hash = "#/practice";
}

function practiceView() {
  const session = state.session;
  if (!session) return el("p", {}, [el("a", { href: "#/setup" }, "請先選擇練習")]);
  const item = session.items[session.index];
  const question = item.question;
  const cap = recordCap(question);
  return el("section", { class: "stack" }, [
    mockBanner(),
    el("div", { class: "row" }, [
      el("span", { class: "chip" }, `${MODE_LABEL[session.mode]} · 第 ${session.index + 1} / ${session.questions.length} 題`),
      el("button", { class: "text-btn", type: "button", onclick: finishEarly }, "結束並看回饋"),
    ]),
    questionCard(question),
    session.phase === "reading" ? readingPanel(session) : null,
    followUpCard(item),
    session.phase !== "reading" ? recorderPanel(session, cap) : null,
    session.error ? el("p", { class: "error", role: "alert" }, session.error) : null,
  ]);
}

function questionCard(question) {
  return el("article", { class: "question" }, [
    el("p", { class: "kicker" }, question.format === "mmi" ? "MMI 站點" : "口試題"),
    el("div", { class: "chips" }, [
      el("span", { class: "chip" }, question.category),
      el("span", { class: "chip" }, DIFFICULTY[question.difficulty] || question.difficulty),
    ]),
    el("p", {}, question.prompt),
    question.scenario ? el("div", { class: "scenario" }, [el("p", { class: "kicker" }, "情境"), el("p", {}, question.scenario)]) : null,
    el("p", { class: "muted" }, "練習題，依公開回憶改寫，不是該校原題。教授不會在這個階段告訴你好不好。重新整理頁面會中斷這一次練習。"),
  ]);
}

function readingPanel(session) {
  const question = currentQuestion();
  if (!session.readingTimer) {
    session.readingTimer = setInterval(() => {
      session.readingLeft -= 1;
      const node = document.querySelector("[data-reading]");
      if (session.readingLeft <= 0) {
        clearInterval(session.readingTimer);
        session.readingTimer = 0;
        session.phase = "idle";
        render();
        return;
      }
      if (node) node.textContent = formatClock(session.readingLeft * 1000);
    }, 1000);
  }
  return el("div", { class: "card" }, [
    el("p", { class: "kicker" }, "閱讀時間"),
    el("p", { class: "timer", "data-reading": "true", "aria-live": "polite" }, formatClock(Math.max(session.readingLeft, 0) * 1000)),
    el("p", { class: "muted" }, `這一站的閱讀時間約 ${question.readingSeconds} 秒。正式面試通常要等時間走完。`),
    el("button", { class: "btn secondary", type: "button", onclick: skipReading }, "我已讀完，開始作答"),
  ]);
}

function skipReading() {
  clearInterval(state.session.readingTimer);
  state.session.readingTimer = 0;
  state.session.phase = "idle";
  render();
}

function followUpCard(item) {
  const follow = [...item.turns].reverse().find((turn) => turn.role === "interviewer" && turn.kind === "follow_up");
  if (!follow) return null;
  const answeredAfter = item.turns.at(-1)?.role === "student";
  if (answeredAfter) return null;
  return el("div", { class: "card" }, [
    el("p", { class: "kicker" }, "教授追問"),
    el("p", { class: "question-follow" }, follow.text),
  ]);
}

function recorderPanel(session, cap) {
  const recording = session.phase === "recording";
  const busy = session.phase === "transcribing" || session.phase === "asking";
  return el("div", { class: "card recorder" }, [
    el("p", { class: "kicker" }, "你的回答"),
    el("p", { class: "timer", "aria-live": "polite" }, [
      formatClock(session.elapsed || 0),
      el("small", {}, ` / 上限 ${formatClock(cap)}`),
    ]),
    el("div", { class: "meter", "aria-hidden": "true" }, [el("span", { style: `width:${Math.min(100, ((session.elapsed || 0) / cap) * 100)}%` })]),
    el("p", { class: "muted" }, `建議作答約 ${formatClock(currentQuestion().answerSeconds * 1000)}。${state.health?.audioNote || "單次錄音最長三分鐘。"}`),
    el("div", { class: "row" }, [
      recording
        ? el("button", { class: "btn seal", type: "button", onclick: stopRecording }, "停止")
        : el("button", { class: "btn seal", type: "button", disabled: busy ? "true" : null, onclick: startRecording }, "開始錄音"),
      session.blob ? el("button", { class: "btn secondary", type: "button", disabled: busy ? "true" : null, onclick: submitAudio }, "送出這段錄音") : null,
      el("button", { class: "btn secondary", type: "button", disabled: busy || recording ? "true" : null, onclick: () => { session.showText = !session.showText; render(); } }, session.showText ? "收合文字" : "改用文字"),
    ]),
    session.audioUrl ? el("audio", { controls: "true", src: session.audioUrl }) : null,
    session.phase === "review" ? reviewBox(session) : null,
    session.showText ? textBox(session, busy) : null,
    busy ? el("p", { class: "muted" }, session.phase === "transcribing" ? "正在整理逐字稿…" : "教授正在看你的回答…") : null,
  ]);
}

function reviewBox(session) {
  return el("div", { class: "stack" }, [
    session.pending?.mockAudio ? el("div", { class: "banner" }, session.pending.notice) : null,
    el("div", { class: "transcript" }, session.pending.transcript),
    el("div", { class: "row" }, [
      el("button", { class: "btn", type: "button", onclick: adoptTranscript }, "採用這段，送給教授"),
      el("button", { class: "btn secondary", type: "button", onclick: discardPending }, "重錄"),
    ]),
  ]);
}

function textBox(session, busy) {
  return el("div", { class: "stack" }, [
    el("label", { for: "answer-text" }, "沒有麥克風時，可以直接打字。正式練習仍建議錄音。"),
    el("textarea", {
      id: "answer-text",
      maxlength: "2000",
      oninput: (event) => { state.draft = event.target.value; },
    }, state.draft),
    el("button", { class: "btn", type: "button", disabled: busy ? "true" : null, onclick: submitText }, "送出文字回答"),
  ]);
}

function reflectView() {
  const session = state.session;
  if (!session?.reflectionQuestion) return el("p", {}, [el("a", { href: "#/setup" }, "沒有進行中的練習")]);
  return el("section", { class: "card stack" }, [
    el("p", { class: "kicker" }, "看回饋之前"),
    el("h1", {}, "先想一句"),
    el("p", {}, session.reflectionQuestion),
    el("p", { class: "muted" }, "這不是加考。寫或不寫都可以。教練不會在這裡給提示。"),
    el("textarea", {
      id: "reflection",
      maxlength: "1000",
      oninput: (event) => { session.reflectionAnswer = event.target.value; },
    }, session.reflectionAnswer || ""),
    el("div", { class: "row" }, [
      el("button", { class: "btn seal", type: "button", onclick: () => loadReport(false) }, "看回饋"),
      el("button", { class: "btn secondary", type: "button", onclick: () => loadReport(true) }, "跳過，直接看回饋"),
    ]),
    session.error ? el("p", { class: "error", role: "alert" }, session.error) : null,
  ]);
}

function reportView(report) {
  if (!report) return el("p", {}, [el("a", { href: "#/history" }, "沒有可看的回饋")]);
  return el("section", { class: "stack" }, [
    report.mock ? el("div", { class: "banner" }, "這份回饋由示範模式在你的裝置這次送出的文字上產生，沒有呼叫 Gemini。") : null,
    el("div", { class: "card" }, [
      el("p", { class: "kicker" }, "練習回饋"),
      el("h1", {}, "教練報告"),
      el("p", {}, report.disclaimer),
      el("p", {}, report.overall),
    ]),
    el("div", { class: "dims" }, report.dimensions.map(dimensionCard)),
    listCard("做得具體的地方", report.strengths),
    listCard("還站不穩的地方", report.weaknesses),
    trapCard(report.trapsHit),
    el("div", { class: "card" }, [
      el("h2", {}, "下一次只改這一點"),
      el("p", {}, report.improvement),
      el("h2", {}, "可以換的結構"),
      el("p", {}, report.betterStructure),
      el("p", { class: "muted" }, "結構不是講稿。不要把它背進下一次面試。"),
    ]),
    el("div", { class: "card" }, [
      el("h2", {}, "說話的痕跡"),
      el("p", {}, report.delivery?.notes || report.deliveryComment || ""),
      report.deliveryComment ? el("p", { class: "muted" }, report.deliveryComment) : null,
    ]),
    sourceCard(),
  ]);
}

function dimensionCard(dimension) {
  const pips = [1, 2, 3, 4, 5].map((score) => el("span", { class: dimension.score >= score ? "pip on" : "pip" }));
  return el("article", { class: "dim" }, [
    el("header", {}, [
      el("h2", {}, dimension.name),
      el("div", {}, [
        el("div", { class: "pips", "aria-hidden": "true" }, pips),
        el("span", { class: "muted" }, dimension.score == null ? "資料不足" : `${dimension.score} / 5`),
      ]),
    ]),
    el("p", {}, dimension.comment),
    ...(dimension.evidence || []).map((quote) => el("blockquote", {}, quote)),
  ]);
}

function listCard(title, items) {
  return el("div", { class: "card" }, [
    el("h2", {}, title),
    items?.length ? el("ul", {}, items.map((item) => el("li", {}, item))) : el("p", { class: "muted" }, "沒有列出。"),
  ]);
}

function trapCard(traps) {
  if (!traps?.length) return el("div", { class: "card" }, [el("h2", {}, "常見弱回答"), el("p", {}, "這次沒有對上題庫裡標出的典型弱點。")]);
  return el("div", { class: "card stack" }, [
    el("h2", {}, "對上的弱回答"),
    ...traps.map((trap) => el("div", {}, [
      el("p", {}, trap.trap),
      trap.evidence ? el("blockquote", {}, trap.evidence) : null,
    ])),
  ]);
}

function sourceCard() {
  const questions = state.session?.questions || state.viewing?.questions || [];
  if (!questions.length) return null;
  return el("div", { class: "card" }, [
    el("h2", {}, "題目從哪裡改寫"),
    el("ul", {}, questions.map((question) => el("li", {}, [
      `${question.category}：`,
      ...question.inspiredBy.flatMap((source, index) => [
        index ? "、" : "",
        el("a", { href: source.url, target: "_blank", rel: "noreferrer" }, `${source.school} ${source.year}`),
      ]),
    ]))),
  ]);
}

function historyView() {
  return el("section", { class: "stack" }, [
    el("div", { class: "row" }, [
      el("h1", {}, "這台裝置上的紀錄"),
      state.history.length ? el("button", { class: "text-btn", type: "button", onclick: clearHistory }, "清除") : null,
    ]),
    el("p", { class: "muted" }, "只存在這個瀏覽器。伺服器不保存音檔或逐字稿。"),
    state.history.length
      ? el("div", { class: "history" }, state.history.map((item) => el("button", { type: "button", onclick: () => openHistory(item) }, [
        el("strong", {}, `${MODE_LABEL[item.mode] || item.mode} · ${new Date(item.at).toLocaleString("zh-TW")}`),
        el("span", { class: "muted" }, item.overall || ""),
      ])))
      : el("p", {}, "還沒有完成的練習。"),
  ]);
}

function privacyView() {
  return el("section", { class: "card stack" }, [
    el("h1", {}, "隱私"),
    el("p", {}, "使用者可能是未成年人。音檔與逐字稿只在產生逐字稿、追問與回饋的那一次請求中處理，處理完即丟棄，不寫入伺服器資料庫、檔案或日誌。"),
    el("p", {}, "若你送出錄音，音檔會傳到這個網站的後端，再由後端傳給 Google Gemini 做轉寫。示範模式沒有金鑰時，不會把音檔送去辨識。"),
    el("p", {}, "練習紀錄（逐字稿與回饋，不含音檔）只放在你這台裝置的 localStorage。清除瀏覽器的網站資料，或按紀錄頁的清除，就會刪掉。"),
    el("p", {}, "速率限制若啟用 Cloudflare KV，只保存 IP 的雜湊與次數，不保存回答內容。沒有綁定 KV 時，次數只留在暫時的記憶體。"),
    el("p", {}, "請不要在練習裡說出身分證字號、病歷號或其他不必分享的敏感資料。"),
  ]);
}

function mockBanner() {
  if (!state.health?.mock) return null;
  return el("div", { class: "banner" }, "目前是示範模式：沒有呼叫 Gemini。用文字作答時，回饋會依你打的內容產生；若送出錄音，逐字稿會是預設例句，不是你的聲音。");
}

async function startRecording() {
  const session = state.session;
  session.error = "";
  discardAudio();
  try {
    media.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    session.error = "無法使用麥克風。你可以改用文字作答。";
    session.showText = true;
    render();
    return;
  }
  const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  media.mime = preferred.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  media.chunks = [];
  media.recorder = new MediaRecorder(media.stream, media.mime ? { mimeType: media.mime } : undefined);
  media.recorder.ondataavailable = (event) => { if (event.data.size) media.chunks.push(event.data); };
  media.recorder.onstop = () => {
    const type = media.recorder.mimeType || media.mime || "audio/webm";
    session.blob = new Blob(media.chunks, { type });
    session.audioUrl = URL.createObjectURL(session.blob);
    session.mime = type;
    releaseStream();
    session.phase = "idle";
    render();
  };
  media.started = performance.now();
  session.phase = "recording";
  session.elapsed = 0;
  media.recorder.start();
  media.timer = setInterval(() => {
    session.elapsed = performance.now() - media.started;
    const node = document.querySelector(".timer");
    const bar = document.querySelector(".meter span");
    if (node) node.firstChild.textContent = formatClock(session.elapsed);
    if (bar) bar.style.width = `${Math.min(100, (session.elapsed / recordCap(currentQuestion())) * 100)}%`;
    if (session.elapsed >= recordCap(currentQuestion())) stopRecording();
  }, 200);
  render();
}

function stopRecording() {
  stopTimer();
  if (media.recorder && media.recorder.state === "recording") media.recorder.stop();
}

async function submitAudio() {
  const session = state.session;
  if (!session.blob) return;
  session.phase = "transcribing";
  session.error = "";
  render();
  try {
    const audioBase64 = await blobToBase64(session.blob);
    const data = await postJson("/api/transcribe", {
      audioBase64,
      mimeType: session.mime || session.blob.type,
      durationMs: Math.round(session.elapsed || 1000),
      questionId: currentQuestion().id,
    });
    session.pending = data;
    session.phase = "review";
  } catch (error) {
    session.error = error.message;
    session.phase = "idle";
  }
  render();
}

async function submitText() {
  const text = state.draft.trim();
  if (!text) {
    state.session.error = "請先寫下回答。";
    render();
    return;
  }
  state.session.phase = "transcribing";
  state.session.error = "";
  render();
  try {
    const data = await postJson("/api/transcribe", { text });
    state.session.pending = data;
    state.draft = "";
    await adoptTranscript();
  } catch (error) {
    state.session.error = error.message;
    state.session.phase = "idle";
    render();
  }
}

async function adoptTranscript() {
  const session = state.session;
  const pending = session.pending;
  if (!pending?.transcript) return;
  const item = session.items[session.index];
  item.turns.push({
    role: "student",
    text: pending.transcript,
    delivery: pending.delivery,
    mockAudio: Boolean(pending.mockAudio),
  });
  session.pending = null;
  discardAudio();
  session.phase = "asking";
  session.error = "";
  render();
  try {
    const data = await postJson("/api/interview", {
      questionId: item.question.id,
      mode: session.mode,
      turns: apiTurns(item),
    });
    if (data.decision === "follow_up" && data.question) {
      item.turns.push({ role: "interviewer", kind: "follow_up", text: data.question });
      session.phase = "idle";
      session.elapsed = 0;
      render();
      return;
    }
    advance();
  } catch (error) {
    item.turns.pop();
    session.error = error.message;
    session.phase = "idle";
    render();
  }
}

function discardPending() {
  state.session.pending = null;
  state.session.phase = "idle";
  discardAudio();
  render();
}

function advance() {
  const session = state.session;
  if (session.index < session.items.length - 1) {
    session.index += 1;
    const question = currentQuestion();
    session.phase = question.format === "mmi" && question.readingSeconds > 0 ? "reading" : "idle";
    session.readingLeft = question.readingSeconds || 0;
    session.elapsed = 0;
    render();
    return;
  }
  beginReflect();
}

function finishEarly() {
  stopMedia();
  const answered = state.session?.items.some((item) => item.turns.some((turn) => turn.role === "student"));
  if (!answered) {
    state.session.error = "請至少回答一題，再結束。";
    render();
    return;
  }
  state.session.items = state.session.items.filter((item) => item.turns.some((turn) => turn.role === "student"));
  beginReflect();
}

async function beginReflect() {
  const session = state.session;
  session.phase = "asking";
  session.error = "";
  location.hash = "#/reflect";
  try {
    const data = await postJson("/api/coach", {
      stage: "reflect",
      mode: session.mode,
      items: session.items.map(apiItem),
    });
    session.reflectionQuestion = data.reflectionQuestion;
  } catch (error) {
    session.error = error.message;
    session.reflectionQuestion = "你覺得教授最可能追問你剛才的哪一句？";
  }
  render();
}

async function loadReport(skip) {
  const session = state.session;
  session.error = "";
  render();
  try {
    session.report = await postJson("/api/coach", {
      stage: "report",
      mode: session.mode,
      reflectionAnswer: skip ? "" : session.reflectionAnswer,
      items: session.items.map(apiItem),
    });
    saveHistory(session);
    location.hash = "#/report";
  } catch (error) {
    session.error = error.message;
    render();
  }
}

function apiItem(item) {
  return { questionId: item.question.id, turns: apiTurns(item) };
}

function apiTurns(item) {
  return [
    { role: "interviewer", kind: "stem", text: item.question.prompt },
    ...item.turns.map((turn) => ({
      role: turn.role,
      kind: turn.kind,
      text: turn.text,
      delivery: turn.delivery,
    })),
  ];
}

function currentQuestion() {
  return state.session.items[state.session.index].question;
}

function recordCap(question) {
  return Math.min(AUDIO_CAP_MS, Math.max((question.answerSeconds || 180) * 1000, 1000));
}

function saveHistory(session) {
  const entry = {
    id: crypto.randomUUID(),
    at: Date.now(),
    mode: session.mode,
    overall: session.report.overall,
    report: session.report,
    questions: session.questions,
  };
  state.history = [entry, ...state.history].slice(0, 20);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
}

function readHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clearHistory() {
  state.history = [];
  localStorage.removeItem(HISTORY_KEY);
  render();
}

function openHistory(item) {
  state.viewing = item;
  state.session = { report: item.report, questions: item.questions, mode: item.mode };
  location.hash = "#/report";
}

function discardAudio() {
  if (state.session?.audioUrl) URL.revokeObjectURL(state.session.audioUrl);
  if (state.session) {
    state.session.audioUrl = "";
    state.session.blob = null;
  }
  releaseStream();
}

function releaseStream() {
  media.stream?.getTracks().forEach((track) => track.stop());
  media.stream = null;
}

function stopTimer() {
  if (media.timer) clearInterval(media.timer);
  media.timer = 0;
}

function stopMedia() {
  stopTimer();
  if (media.recorder?.state === "recording") media.recorder.stop();
  if (state.session?.readingTimer) {
    clearInterval(state.session.readingTimer);
    state.session.readingTimer = 0;
  }
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(data.error || "請求失敗");
  return data;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    throw new Error("伺服器沒有回傳 JSON。");
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("無法讀取錄音。"));
    reader.readAsDataURL(blob);
  });
}

function shuffle(list) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function formatClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "style") node.setAttribute("style", value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  }
  if (tag === "textarea") {
    node.value = [].concat(children).filter((child) => typeof child === "string").join("");
    return node;
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}
