const state = {
  tools: [],
  questions: [],
  rules: [],
  answers: {},
  currentQuestionIndex: 0,
  rankings: [],
  scoreLookup: new Map(),
  previousRanks: new Map(),
};

const elements = {
  questionnaireStatus: document.querySelector("#questionnaire-status"),
  questionnaireProgress: document.querySelector("#questionnaire-progress"),
  progressFill: document.querySelector("#progress-fill"),
  steps: document.querySelector("#steps"),
  answerSummary: document.querySelector("#answer-summary"),
  questionnaire: document.querySelector("#questionnaire"),
  previousBtn: document.querySelector("#previous-btn"),
  nextBtn: document.querySelector("#next-btn"),
  resetBtn: document.querySelector("#reset-btn"),
  topRecommendation: document.querySelector("#top-recommendation"),
  cardsGrid: document.querySelector("#cards-grid"),
};

const cardRegistry = new Map();

document.addEventListener("DOMContentLoaded", init);

const EXTERNAL_LINK_ICON = `
  <svg class="external-link-icon" aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
    <path d="M14 4h6v6" />
    <path d="M10 14 20 4" />
    <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
  </svg>
`;

const UDEM_AI_GUIDE_LICENSE_URL =
  "https://boite-outils.bib.umontreal.ca/trouver-evaluer/iag?p=5425689";

async function init() {
  bindEvents();

  try {
    const [tools, questions, scoring] = await Promise.all([
      fetchJson("data/tools.json"),
      fetchJson("data/questions.json"),
      fetchJson("data/scoring.json"),
    ]);

    state.tools = tools;
    state.questions = questions;
    state.rules = scoring.rules;
    state.scoreLookup = buildScoreLookup(state.rules);

    computeRankings();
    renderAll();
  } catch (error) {
    console.error(error);
    renderError(
      "Les données JSON n'ont pas pu être chargées. Lancez un serveur local dans le dossier du projet pour permettre au navigateur de lire `data/*.json`."
    );
  }
}

function bindEvents() {
  elements.previousBtn.addEventListener("click", () => {
    state.currentQuestionIndex = Math.max(0, state.currentQuestionIndex - 1);
    renderQuestionnaire();
    focusCurrentQuestionHeading();
  });

  elements.nextBtn.addEventListener("click", () => {
    const isLastQuestion =
      state.currentQuestionIndex === state.questions.length - 1;

    if (isLastQuestion) {
      document
        .querySelector(".recommendations-panel")
        .scrollIntoView({ behavior: "smooth", block: "start" });
      focusRecommendationsHeading();
      return;
    }

    state.currentQuestionIndex = Math.min(
      state.questions.length - 1,
      state.currentQuestionIndex + 1
    );
    renderQuestionnaire();
    focusCurrentQuestionHeading();
  });

  elements.resetBtn.addEventListener("click", () => {
    state.answers = {};
    state.currentQuestionIndex = 0;
    state.previousRanks = new Map();
    computeRankings();
    renderAll();
    focusCurrentQuestionHeading();
  });

  elements.steps.addEventListener("click", (event) => {
    const button = event.target.closest("[data-step-index]");
    if (!button) {
      return;
    }

    state.currentQuestionIndex = Number(button.dataset.stepIndex);
    renderQuestionnaire();
    focusCurrentQuestionHeading();
  });

  elements.questionnaire.addEventListener("click", (event) => {
    const optionButton = event.target.closest("[data-option-id]");
    if (!optionButton) {
      return;
    }

    const questionId = optionButton.dataset.questionId;
    const optionId = optionButton.dataset.optionId;
    handleAnswer(questionId, optionId);
  });

  elements.questionnaire.addEventListener("keydown", (event) => {
    const optionButton = event.target.closest("[data-option-id]");
    if (!optionButton) {
      return;
    }

    const navigationKeys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!navigationKeys.includes(event.key)) {
      return;
    }

    event.preventDefault();
    focusSiblingOption(optionButton, event.key);
  });
}

async function fetchJson(path) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Impossible de charger ${path}`);
  }

  return response.json();
}

function buildScoreLookup(rules) {
  const lookup = new Map();

  rules.forEach((rule) => {
    lookup.set(`${rule.questionId}:${rule.optionId}`, rule.effects);
  });

  return lookup;
}

function handleAnswer(questionId, optionId) {
  const currentQuestion = state.questions[state.currentQuestionIndex];
  const shouldAdvance =
    currentQuestion &&
    currentQuestion.id === questionId &&
    state.currentQuestionIndex < state.questions.length - 1;

  state.answers[questionId] = optionId;

  if (shouldAdvance) {
    state.currentQuestionIndex += 1;
  }

  computeRankings();
  renderAll();

  if (shouldAdvance) {
    focusCurrentQuestionHeading();
    return;
  }

  focusCurrentOption(questionId, optionId);
}

function computeRankings() {
  const rankings = state.tools.map((tool, defaultIndex) => {
    let score = 0;
    const contributions = [];

    Object.entries(state.answers).forEach(([questionId, optionId]) => {
      const effects = state.scoreLookup.get(`${questionId}:${optionId}`) || [];
      effects.forEach((effect) => {
        if (effect.toolId !== tool.id) {
          return;
        }

        score += effect.delta;
        contributions.push({
          ...effect,
          questionId,
          optionId,
          optionLabel: getOptionLabel(questionId, optionId),
          questionTitle: getQuestionTitle(questionId),
        });
      });
    });

    const positiveReasons = contributions
      .filter((item) => item.delta > 0)
      .sort((left, right) => right.delta - left.delta);

    const negativeReasons = contributions
      .filter((item) => item.delta < 0)
      .sort((left, right) => left.delta - right.delta);

    return {
      tool,
      score,
      defaultIndex,
      positiveReasons,
      negativeReasons,
      contributions,
    };
  });

  rankings.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (right.positiveReasons.length !== left.positiveReasons.length) {
      return right.positiveReasons.length - left.positiveReasons.length;
    }

    return left.defaultIndex - right.defaultIndex;
  });

  state.rankings = rankings.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    previousRank: state.previousRanks.get(entry.tool.id) || index + 1,
  }));

  state.previousRanks = new Map(
    state.rankings.map((entry) => [entry.tool.id, entry.rank])
  );
}

function renderAll() {
  renderMetrics();
  renderQuestionnaire();
  renderSpotlight();
  renderCards();
}

function renderMetrics() {
  const answeredCount = Object.keys(state.answers).length;
  const totalQuestions = state.questions.length;

  elements.questionnaireStatus.textContent =
    answeredCount === totalQuestions
      ? "Questionnaire complet. Ajustez librement les réponses."
      : "Les cartes se réordonnent à chaque réponse sélectionnée.";

  const progress = totalQuestions === 0 ? 0 : (answeredCount / totalQuestions) * 100;
  elements.progressFill.style.width = `${progress}%`;
  elements.questionnaireProgress.setAttribute("aria-valuenow", String(Math.round(progress)));
  elements.questionnaireProgress.setAttribute(
    "aria-valuetext",
    `${answeredCount} question${answeredCount > 1 ? "s" : ""} sur ${totalQuestions} répondue${
      answeredCount > 1 ? "s" : ""
    }`
  );
}

function renderQuestionnaire() {
  renderSteps();
  renderAnswerSummary();

  const question = state.questions[state.currentQuestionIndex];
  if (!question) {
    elements.questionnaire.innerHTML = "";
    return;
  }

  const selectedOptionId = state.answers[question.id];
  const selectedOption = question.options.find((option) => option.id === selectedOptionId);
  const questionTitleId = `question-${question.id}-title`;
  const questionDescriptionId = `question-${question.id}-description`;
  const optionsMarkup = question.options
    .map((option, optionIndex) => {
      const isSelected = option.id === selectedOptionId;
      const isTabbable = selectedOptionId ? isSelected : optionIndex === 0;
      const optionDescriptionId = `option-${question.id}-${option.id}-description`;
      return `
        <button
          class="option-card ${isSelected ? "is-selected" : ""}"
          type="button"
          data-question-id="${question.id}"
          data-option-id="${option.id}"
          data-option-index="${optionIndex}"
          role="radio"
          aria-checked="${isSelected ? "true" : "false"}"
          aria-describedby="${optionDescriptionId}"
          tabindex="${isTabbable ? "0" : "-1"}"
        >
          <p class="option-label">${option.label}</p>
          <p class="option-description" id="${optionDescriptionId}">${option.description}</p>
        </button>
      `;
    })
    .join("");

  elements.questionnaire.innerHTML = `
    <div class="question-stage-top">
      <div class="question-header">
        <div>
          <p class="question-kicker">Question</p>
          <h3 id="${questionTitleId}" tabindex="-1">${question.title}</h3>
          <p id="${questionDescriptionId}">${question.description}</p>
        </div>
        <div class="question-counter">
          ${state.currentQuestionIndex + 1}/${state.questions.length}
        </div>
      </div>
      <div class="question-current-answer ${selectedOption ? "is-filled" : ""}">
        <span class="question-current-label">${
          selectedOption ? "Réponse retenue" : "Action attendue"
        }</span>
        <strong>${
          selectedOption
            ? selectedOption.label
            : "Choisissez l’option la plus proche de votre besoin."
        }</strong>
      </div>
    </div>
    <div
      class="options-grid"
      role="radiogroup"
      aria-labelledby="${questionTitleId}"
      aria-describedby="${questionDescriptionId}"
    >
      ${optionsMarkup}
    </div>
  `;

  const isLastQuestion = state.currentQuestionIndex === state.questions.length - 1;
  elements.previousBtn.disabled = state.currentQuestionIndex === 0;
  elements.nextBtn.textContent = isLastQuestion ? "Voir les résultats" : "Continuer";
}

function renderSteps() {
  const markup = state.questions
    .map((question, index) => {
      const selectedOption = getSelectedOption(question.id);
      const classes = [
        "step-button",
        index === state.currentQuestionIndex ? "is-current" : "",
        selectedOption ? "is-answered" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return `
        <button
          class="${classes}"
          type="button"
          data-step-index="${index}"
          ${index === state.currentQuestionIndex ? 'aria-current="step"' : ""}
          aria-label="Question ${index + 1} sur ${state.questions.length} : ${
            question.title
          }. ${selectedOption ? `Réponse actuelle : ${selectedOption.label}.` : "Pas encore renseignée."}"
        >
          <span class="step-index">${index + 1}</span>
          <div>
            <p class="step-title">${question.title}</p>
            <p class="step-meta">${
              selectedOption ? selectedOption.label : "Pas encore renseignée"
            }</p>
          </div>
        </button>
      `;
    })
    .join("");

  elements.steps.innerHTML = markup;
}

function renderAnswerSummary() {
  const answeredQuestions = state.questions.filter(
    (question) => state.answers[question.id]
  );

  if (answeredQuestions.length === 0) {
    elements.answerSummary.innerHTML = `
      <p class="helper-text">
        Commencez par une première réponse. Vos choix s’accumulent ici et le classement se réordonne immédiatement.
      </p>
    `;
    return;
  }

  elements.answerSummary.innerHTML = answeredQuestions
    .map((question) => {
      const option = getSelectedOption(question.id);
      return `
        <div class="summary-chip">
          <small>${question.title}</small>
          <strong>${option.label}</strong>
        </div>
      `;
    })
    .join("");
}

function renderSpotlight() {
  const answeredCount = Object.keys(state.answers).length;

  if (answeredCount === 0) {
    elements.topRecommendation.className = "spotlight is-empty";
    elements.topRecommendation.innerHTML = `
      <div>
        <p class="spotlight-label">Recommandation du moment</p>
        <h3 class="spotlight-name">Le radar attend un premier signal.</h3>
        <p class="helper-text">
          Dès que vous répondez à une question, un outil dominant apparaît ici avec son profil et les raisons principales de sa montée.
        </p>
      </div>
    `;
    return;
  }

  const top = state.rankings[0];
  const institutionalBadge = renderInstitutionalBadge(top.tool);
  const reasons = top.positiveReasons.length
    ? top.positiveReasons.slice(0, 2)
    : [
        {
          reason: top.tool.defaultReason,
        },
      ];

  const spotlightFacts = [
    ["Corpus", top.tool.corpus],
    ["Recherche", top.tool.ragScope],
    ["Sortie", top.tool.outputs.join(" + ")],
  ]
    .map(
      ([label, value]) => `
        <div class="fact-chip">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `
    )
    .join("");

  elements.topRecommendation.className = "spotlight";
  elements.topRecommendation.innerHTML = `
    <div class="spotlight-top">
      <div>
        <p class="spotlight-label">Recommandation du moment</p>
        <h3 class="spotlight-name">${top.tool.name}</h3>
        <p class="spotlight-text">${top.tool.bestFor}</p>
      </div>
      ${institutionalBadge ? `<div class="spotlight-meta">${institutionalBadge}</div>` : ""}
    </div>
    <div class="spotlight-facts">
      ${spotlightFacts}
    </div>
    <div class="spotlight-section">
      <p class="spotlight-subtitle">Pourquoi cet outil remonte</p>
      <ul class="spotlight-reasons">
        ${reasons
          .map((item) => `<li>${item.reason}</li>`)
          .join("")}
      </ul>
    </div>
    <a class="spotlight-link" href="${top.tool.url}" target="_blank" rel="noreferrer">
      <span>Ouvrir ${top.tool.name}</span>
      <span class="sr-only">, ouvre dans un nouvel onglet</span>
      ${EXTERNAL_LINK_ICON}
    </a>
  `;
}

function renderCards() {
  const firstRects = new Map();
  Array.from(elements.cardsGrid.children).forEach((card) => {
    firstRects.set(card.dataset.toolId, card.getBoundingClientRect());
  });

  const fragment = document.createDocumentFragment();

  state.rankings.forEach((entry) => {
    const card = cardRegistry.get(entry.tool.id) || createCard(entry.tool.id);
    updateCard(card, entry);
    fragment.appendChild(card);
  });

  elements.cardsGrid.innerHTML = "";
  elements.cardsGrid.appendChild(fragment);

  Array.from(elements.cardsGrid.children).forEach((card) => {
    const firstRect = firstRects.get(card.dataset.toolId);
    const lastRect = card.getBoundingClientRect();

    if (!firstRect) {
      card.animate(
        [
          { opacity: 0, transform: "translateY(14px) scale(0.98)" },
          { opacity: 1, transform: "translateY(0) scale(1)" },
        ],
        {
          duration: 420,
          easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
        }
      );
      return;
    }

    const deltaX = firstRect.left - lastRect.left;
    const deltaY = firstRect.top - lastRect.top;

    if (deltaX !== 0 || deltaY !== 0) {
      card.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: "translate(0, 0)" },
        ],
        {
          duration: 520,
          easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
        }
      );
    }
  });
}

function createCard(toolId) {
  const card = document.createElement("article");
  card.className = "tool-card";
  card.dataset.toolId = toolId;
  cardRegistry.set(toolId, card);
  return card;
}

function updateCard(card, entry) {
  const movement = entry.previousRank - entry.rank;
  const movementBadge =
    movement === 0
      ? ""
      : `<span class="movement-badge" aria-label="${
          movement > 0 ? "Cet outil monte dans le classement" : "Cet outil descend dans le classement"
        }">${movement > 0 ? "↑" : "↓"}</span>`;
  const primaryReason = entry.positiveReasons[0]?.reason || entry.tool.defaultReason;
  const penaltyReason = entry.negativeReasons[0]?.reason || "";
  const institutionalBadge = renderInstitutionalBadge(entry.tool);
  const institutionalAccessNote = renderInstitutionalAccessNote(entry.tool);
  const privacyWarning = renderPrivacyWarning(entry.tool);
  const toolFacts = [
    ["Corpus", entry.tool.corpus],
    ["Recherche", entry.tool.ragScope],
    ["Sortie", entry.tool.outputs.join(" + ")],
  ]
    .map(
      ([label, value]) => `
        <div>
          <dt>${label}</dt>
          <dd>${value}</dd>
        </div>
      `
    )
    .join("");

  const showPrimaryReason = !isDuplicateText(entry.tool.bestFor, primaryReason);
  const cardNote = penaltyReason
    ? `<p class="reason-inline reason-inline-warning"><strong>Frein actuel :</strong> ${penaltyReason}</p>`
    : showPrimaryReason
      ? `<p class="reason-inline">${primaryReason}</p>`
      : "";

  card.dataset.rank = String(entry.rank);
  card.style.setProperty("--tool-accent", entry.tool.accent);
  card.innerHTML = `
    <div class="card-top">
      <div>
        <div class="badge-row">
          <span class="rank-badge">#${entry.rank}</span>
        </div>
        <p class="tool-category">${entry.tool.category}</p>
      </div>
      <div>
        ${institutionalBadge}
        ${movementBadge}
      </div>
    </div>

    <div class="card-body">
      <div class="card-primary">
        <div>
          <h3 class="tool-name">${entry.tool.name}</h3>
          <p class="tool-tagline">${entry.tool.tagline}</p>
        </div>

        <div class="tag-row">
          ${entry.tool.focus.map((item) => `<span class="tag">${item}</span>`).join("")}
        </div>

        <p class="tool-summary">${entry.tool.bestFor}</p>
        ${cardNote}
        ${institutionalAccessNote}
        ${privacyWarning}
      </div>

      <div class="card-side">
        <dl class="tool-facts">
          ${toolFacts}
        </dl>
        <a class="tool-link" href="${entry.tool.url}" target="_blank" rel="noreferrer">
          <span>Ouvrir ${entry.tool.name}</span>
          <span class="sr-only">, ouvre dans un nouvel onglet</span>
          ${EXTERNAL_LINK_ICON}
        </a>
      </div>
    </div>
  `;
}

function renderInstitutionalBadge(tool) {
  if (!tool.institutionalLicense) {
    return "";
  }

  const label = tool.licenseLabel || "Licence institutionnelle UdeM";
  return `
    <a
      class="license-badge"
      href="${UDEM_AI_GUIDE_LICENSE_URL}"
      target="_blank"
      rel="noreferrer"
      title="Consulter le guide des bibliothèques sur les fonctionnalités d'IA incluses dans les licences institutionnelles"
    >
      ${label}
      <span class="sr-only">, ouvre dans un nouvel onglet</span>
    </a>
  `;
}

function renderInstitutionalAccessNote(tool) {
  if (!tool.institutionalAccessNote) {
    return "";
  }

  return `
    <p class="access-note">
      ${tool.institutionalAccessNote}
      <a href="${UDEM_AI_GUIDE_LICENSE_URL}" target="_blank" rel="noreferrer">
        Voir les consignes d’accès.
        <span class="sr-only">, ouvre dans un nouvel onglet</span>
      </a>
    </p>
  `;
}

function renderPrivacyWarning(tool) {
  if (!tool.privacyWarning) {
    return "";
  }

  return `
    <p class="privacy-warning">
      <strong>Avertissement :</strong>
      ${tool.privacyWarning}
    </p>
  `;
}

function renderError(message) {
  elements.questionnaireStatus.textContent = "Erreur de chargement";
  elements.questionnaire.innerHTML = `<p class="helper-text">${message}</p>`;
  elements.topRecommendation.className = "spotlight is-empty";
  elements.topRecommendation.innerHTML = `<p class="helper-text">${message}</p>`;
  elements.cardsGrid.innerHTML = "";
  elements.previousBtn.disabled = true;
  elements.nextBtn.disabled = true;
  elements.resetBtn.disabled = true;
}

function focusCurrentQuestionHeading() {
  const heading = elements.questionnaire.querySelector("h3");
  if (!heading) {
    return;
  }

  heading.focus({ preventScroll: true });
}

function focusCurrentOption(questionId, optionId) {
  const optionButton = elements.questionnaire.querySelector(
    `[data-question-id="${questionId}"][data-option-id="${optionId}"]`
  );

  if (!optionButton) {
    return;
  }

  optionButton.focus({ preventScroll: true });
}

function focusSiblingOption(currentOption, key) {
  const options = Array.from(
    elements.questionnaire.querySelectorAll(
      `[data-question-id="${currentOption.dataset.questionId}"][data-option-id]`
    )
  );

  if (options.length === 0) {
    return;
  }

  const currentIndex = options.indexOf(currentOption);
  const lastIndex = options.length - 1;
  let nextIndex = currentIndex;

  if (key === "Home") {
    nextIndex = 0;
  } else if (key === "End") {
    nextIndex = lastIndex;
  } else if (key === "ArrowRight" || key === "ArrowDown") {
    nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
  } else if (key === "ArrowLeft" || key === "ArrowUp") {
    nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
  }

  options[nextIndex]?.focus({ preventScroll: true });
  options.forEach((option, index) => {
    option.tabIndex = index === nextIndex ? 0 : -1;
  });
}

function focusRecommendationsHeading() {
  const heading = document.querySelector("#recommendations-title");
  if (!heading) {
    return;
  }

  heading.focus({ preventScroll: true });
}

function getSelectedOption(questionId) {
  const question = state.questions.find((item) => item.id === questionId);
  if (!question) {
    return null;
  }

  return (
    question.options.find((option) => option.id === state.answers[questionId]) || null
  );
}

function getOptionLabel(questionId, optionId) {
  const question = state.questions.find((item) => item.id === questionId);
  const option = question?.options.find((item) => item.id === optionId);
  return option ? option.label : optionId;
}

function getQuestionTitle(questionId) {
  const question = state.questions.find((item) => item.id === questionId);
  return question ? question.title : questionId;
}

function isDuplicateText(left, right) {
  const normalizedLeft = normalizeForComparison(left);
  const normalizedRight = normalizeForComparison(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function normalizeForComparison(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
