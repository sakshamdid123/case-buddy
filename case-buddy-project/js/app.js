// --- Direct PDF.js Import ---
import * as pdfjsLib from 'https://mozilla.github.io/pdf.js/build/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://mozilla.github.io/pdf.js/build/pdf.worker.mjs';

// --- State Management ---
let currentCase = null;
let pdfDoc = null, pageNum = 1, pageRendering = false, pageNumPending = null;
let currentRenderTask = null;
let selectedTypes = [];
let selectedDifficulties = [];
let selectedCompanies = [];

// --- NEW TIMER STATE ---
let timerInterval;
let secondsElapsed = 0;

function startTimer() {
    secondsElapsed = 0;
    document.getElementById('session-timer').textContent = "00:00";
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        secondsElapsed++;
        const mins = Math.floor(secondsElapsed / 60).toString().padStart(2, '0');
        const secs = (secondsElapsed % 60).toString().padStart(2, '0');
        document.getElementById('session-timer').textContent = `${mins}:${secs}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
}
        
// User State
let userProfile = JSON.parse(localStorage.getItem('caseBuddyUser')) || null;
if(userProfile && !userProfile.history) {
    userProfile.history = [];
    userProfile.stats = { solved: 0, streak: 1, lastActive: new Date().toISOString() };
    localStorage.setItem('caseBuddyUser', JSON.stringify(userProfile));
}

// --- SANDBOX CONFIG & VARIABLES ---
let recognition;
let isRecording = false;
let finalTranscript = '';
let generatedAiFeedback = null;

// --- DOM Elements ---
const views = {
    welcome: document.getElementById('welcome-view'),
    library: document.getElementById('case-library-view'),
    detail: document.getElementById('detailed-case-view'),
    progress: document.getElementById('in-progress-view'),
    about: document.getElementById('about-view'),
    dashboard: document.getElementById('dashboard-view'),
    profile: document.getElementById('profile-view')
};

const caseGrid = document.getElementById('case-grid');
const homeButton = document.getElementById('home-button');
const navActionsContainer = document.getElementById('nav-actions-container');

// Filter elements
const typeFiltersContainer = document.getElementById('type-filters');
const difficultyFiltersContainer = document.getElementById('difficulty-filters');
const openCompanyModalBtn = document.getElementById('open-company-modal-btn');
const companyCountEl = document.getElementById('company-count');
const searchCasesBtn = document.getElementById('search-cases-btn');
const viewAllBtn = document.getElementById('view-all-btn');
const backToFiltersBtn = document.getElementById('back-to-filters-btn');

// Detailed View Elements
const backToLibraryBtn = document.getElementById('back-to-library-btn');
const doCaseBtn = document.getElementById('do-case-btn');

// In-Progress View Elements (Updated)
const pdfCanvas = document.getElementById('pdf-canvas'),
      pdfRenderContainer = document.getElementById('pdf-render-container'),
      pageNumEl = document.getElementById('page-num'),
      pageCountEl = document.getElementById('page-count'),
      prevPageBtn = document.getElementById('pdf-prev'),
      nextPageBtn = document.getElementById('pdf-next'),
      fullscreenBtn = document.getElementById('pdf-fullscreen');

// Panel Toggle Elements
const interviewActivePanel = document.getElementById('interview-active-panel');
const interviewFeedbackPanel = document.getElementById('interview-feedback-panel');
const endCaseBtn = document.getElementById('end-case-btn');
const inlineRecordBtn = document.getElementById('inline-record-btn');
const hiddenTranscriptBox = document.getElementById('hidden-transcript-box');
const micStatusText = document.getElementById('mic-status-text');
const aiInsightContainer = document.getElementById('ai-insight-container');
const loadingAi = document.getElementById('loading-ai');
const aiOutputContent = document.getElementById('ai-output-content');
const retryFeedbackBtn = document.getElementById('retry-feedback-btn');
const saveCompleteBtn = document.getElementById('save-complete-btn');


// Modals
const companyModal = document.getElementById('company-modal');
const warningModal = document.getElementById('warning-modal');
const loginModal = document.getElementById('login-modal');

const companyListContainer = document.getElementById('company-list');
const allCompaniesCheckbox = document.getElementById('all-companies-checkbox');
const clearCompaniesBtn = document.getElementById('clear-companies-btn');
const applyCompaniesBtn = document.getElementById('apply-companies-btn');
const cancelWarningBtn = document.getElementById('cancel-warning-btn');
const proceedBtn = document.getElementById('proceed-btn');

// Login Modal Elements
const loginForm = document.getElementById('login-form');
const mascotContainer = document.getElementById('mascot-selection-container');
const mascotInput = document.getElementById('selected-mascot-id');
const skipLoginBtn = document.getElementById('skip-login-btn');

// --- Main App Functions ---

function showView(viewToShow) {
    Object.values(views).forEach(el => el.classList.add('hidden'));
    viewToShow.classList.remove('hidden');
    window.scrollTo(0, 0);
    
    // Remove keyboard listener if leaving progress view
    if (viewToShow !== views.progress) {
        document.removeEventListener('keydown', handlePdfKeyboardNav);
    }
}

function createCaseCard(caseData) {
    const card = document.createElement('div');
    card.className = 'case-card bg-white p-6 rounded-lg cursor-pointer flex flex-col';
    card.innerHTML = `
        <h3 class="font-bold text-xl mb-2 truncate">${caseData.title}</h3>
        <p class="text-slate-500 text-sm mb-4 h-10 overflow-hidden flex-grow">${caseData.problem}</p>
        <div class="flex items-center flex-wrap gap-2 text-sm text-slate-500 mt-4">
            <span class="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-medium">${caseData.type}</span>
            <span class="bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-medium">${caseData.company}</span>
            <span class="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full font-medium">${caseData.difficulty}</span>
        </div>
    `;
    card.addEventListener('click', () => showDetailedCaseView(caseData.id));
    return card;
}

function renderLibraryView(casesToRender) {
    caseGrid.innerHTML = casesToRender.length === 0 ? `<p class="text-slate-500 col-span-full text-center text-lg">No cases match your criteria. Try broadening your search!</p>` : '';
    casesToRender.forEach(c => caseGrid.appendChild(createCaseCard(c)));
    showView(views.library);
}

function showDetailedCaseView(caseId) {
    const caseData = allCases.find(c => c.id === caseId);
    if (!caseData) return;
    currentCase = caseData;
    document.getElementById('case-detail-type').textContent = caseData.type;
    document.getElementById('case-detail-company').textContent = caseData.company;
    document.getElementById('case-detail-difficulty').textContent = caseData.difficulty;
    document.getElementById('case-detail-problem').textContent = caseData.problem;
    showView(views.detail);
}

async function showInProgressView() {
    document.getElementById('casebook-title').textContent = `${currentCase.company}: ${currentCase.title}`;
    const pdfPath = casebooks[currentCase.id] || casebooks.default;
    
    // RESET PANEL STATES
    interviewActivePanel.classList.remove('hidden');
    interviewActivePanel.classList.add('flex');
    interviewFeedbackPanel.classList.add('hidden');
    interviewFeedbackPanel.classList.remove('flex');
    
    // RESET FEEDBACK UI
    resetInlineFeedbackUI();

    startTimer();

    await initPdfViewer(pdfPath);
    showView(views.progress);
    
    // ENABLE ARROW KEYS
    document.addEventListener('keydown', handlePdfKeyboardNav);
}

// --- Filter Population and Handling ---

function populateMultiSelectFilters(container, items, stateArray) {
    container.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.className = 'filter-btn px-4 py-2 rounded-lg font-medium active';
    allBtn.textContent = 'All';
    allBtn.dataset.value = 'All';
    container.appendChild(allBtn);

    items.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'filter-btn px-4 py-2 rounded-lg font-medium';
        btn.textContent = item;
        btn.dataset.value = item;
        container.appendChild(btn);
    });

    container.addEventListener('click', (e) => {
        if (e.target.tagName !== 'BUTTON') return;
        const value = e.target.dataset.value;
        const allButton = container.querySelector('[data-value="All"]');
        
        if (value === 'All') {
            e.target.classList.add('active');
            container.querySelectorAll('button:not([data-value="All"])').forEach(btn => btn.classList.remove('active'));
            stateArray.length = 0;
        } else {
            allButton.classList.remove('active');
            e.target.classList.toggle('active');
            const index = stateArray.indexOf(value);
            if (index > -1) {
                stateArray.splice(index, 1);
            } else {
                stateArray.push(value);
            }
            if (container.querySelectorAll('button.active:not([data-value="All"])').length === 0) {
                allButton.classList.add('active');
            }
        }
    });
}

function populateCompanyModal() {
    const companies = [...new Set(allCases.map(c => c.company))].sort();
    companyListContainer.innerHTML = '';
    companies.forEach(company => {
        const label = document.createElement('label');
        label.className = 'flex items-center space-x-2 text-slate-700';
        label.innerHTML = `
            <input type="checkbox" value="${company}" class="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 company-checkbox">
            <span>${company}</span>
        `;
        companyListContainer.appendChild(label);
    });
}

function handleSearch() {
    const filteredCases = allCases.filter(c => {
        const typeMatch = selectedTypes.length === 0 || selectedTypes.includes(c.type);
        const difficultyMatch = selectedDifficulties.length === 0 || selectedDifficulties.includes(c.difficulty);
        const companyMatch = selectedCompanies.length === 0 || selectedCompanies.includes(c.company);
        return typeMatch && difficultyMatch && companyMatch;
    });
    renderLibraryView(filteredCases);
}

// --- PDF Viewer Functions ---
async function initPdfViewer(url) {
    pageNum = 1;
    try {
        const loadingTask = pdfjsLib.getDocument(url);
        pdfDoc = await loadingTask.promise;
        pageCountEl.textContent = pdfDoc.numPages;
        renderPage(pageNum);
    } catch (error) {
        console.error('Error loading PDF:', error);
        pdfRenderContainer.innerHTML = `<p class="text-white text-center">Error loading PDF. Check console.</p>`;
    }
}

function renderPage(num, isResize = false) {
    if (pageRendering) {
        if(currentRenderTask) currentRenderTask.cancel();
        pageNumPending = num;
        return;
    }
    pageRendering = true;

    if (!isResize) pdfCanvas.style.opacity = '0';

    pdfDoc.getPage(num).then(page => {
        const devicePixelRatio = window.devicePixelRatio || 1;
        // Calculate scale to fit container width, but max out at sensible zoom
        const containerWidth = pdfRenderContainer.clientWidth;
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = (containerWidth - 40) / unscaledViewport.width; // 40px padding buffer
        const viewport = page.getViewport({ scale: Math.min(scale, 1.5) });

        const context = pdfCanvas.getContext('2d');
        pdfCanvas.style.width = `${viewport.width}px`;
        pdfCanvas.style.height = `${viewport.height}px`;
        pdfCanvas.width = Math.floor(viewport.width * devicePixelRatio);
        pdfCanvas.height = Math.floor(viewport.height * devicePixelRatio);
        context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

        const renderContext = { canvasContext: context, viewport: viewport };

        currentRenderTask = page.render(renderContext);
        currentRenderTask.promise.then(() => {
            pageRendering = false;
            currentRenderTask = null;
            if (!isResize) pdfCanvas.style.opacity = '1';
            if (pageNumPending !== null) {
                renderPage(pageNumPending);
                pageNumPending = null;
            }
        });
    });
    pageNumEl.textContent = num;
}

function onPrevPage() { if (pageNum <= 1) return; pageNum--; renderPage(pageNum); }
function onNextPage() { if (pageNum >= pdfDoc.numPages) return; pageNum++; renderPage(pageNum); }

function handlePdfKeyboardNav(e) {
    if (e.key === 'ArrowLeft') onPrevPage();
    if (e.key === 'ArrowRight') onNextPage();
}

function toggleFullscreen() {
     if (!document.fullscreenElement) {
        pdfRenderContainer.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
        });
    } else {
        document.exitFullscreen();
    }
}

// --- NEW FEEDBACK LOGIC (INLINE PANEL) ---

function transitionToFeedbackMode() {
    stopTimer(); // <--- ADD THIS LINE
    // Hide Active, Show Feedback
    interviewActivePanel.classList.add('hidden');
    interviewActivePanel.classList.remove('flex');
    
    interviewFeedbackPanel.classList.remove('hidden');
    interviewFeedbackPanel.classList.add('flex');
    
    // Initialize Mic
    setupSpeechRecognition();
}

function resetInlineFeedbackUI() {
    // Reset Stars
    document.querySelectorAll('.inline-rating input[type="radio"]').forEach(r => r.checked = false);
    
    // Reset Mic
    inlineRecordBtn.classList.remove('recording');
    inlineRecordBtn.innerHTML = '<i class="ph ph-microphone"></i>';
    micStatusText.textContent = "Tap to record feedback";
    hiddenTranscriptBox.value = '';
    
    // Hide AI, Show Mic
    document.getElementById('mic-interface').classList.remove('hidden');
    aiInsightContainer.classList.add('hidden');
    loadingAi.classList.add('hidden');
    aiOutputContent.innerHTML = '';
    
    finalTranscript = '';
    isRecording = false;
    generatedAiFeedback = null;
}

function setupSpeechRecognition() {
     const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
     if (!SpeechRecognition) {
         micStatusText.textContent = "⚠️ Browser not supported (Use Chrome)";
         return;
     }
     recognition = new SpeechRecognition();
     recognition.continuous = true; 
     recognition.interimResults = true; 
     recognition.lang = 'en-US';

     recognition.onstart = () => {
        isRecording = true;
        inlineRecordBtn.classList.add('recording');
        inlineRecordBtn.innerHTML = '<i class="ph ph-stop"></i>';
        micStatusText.textContent = "Listening... Tap to stop";
        finalTranscript = '';
    };

    recognition.onend = () => {
        isRecording = false;
        inlineRecordBtn.classList.remove('recording');
        inlineRecordBtn.innerHTML = '<i class="ph ph-microphone"></i>';
        
        // AUTO TRIGGER AI
        if (finalTranscript.trim().length > 5) {
            processFeedbackWithAI(finalTranscript);
        } else {
            micStatusText.textContent = "Too short. Tap to try again.";
        }
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }
        hiddenTranscriptBox.value = finalTranscript + interimTranscript;
    };
}

async function processFeedbackWithAI(text) {
    // HIDE MIC, SHOW LOADING
    document.getElementById('mic-interface').classList.add('hidden');
    aiInsightContainer.classList.remove('hidden');
    loadingAi.classList.remove('hidden');
    aiOutputContent.innerHTML = '';
    retryFeedbackBtn.classList.add('hidden');

    const fullPrompt = `
        Act as a senior McKinsey partner. Convert this raw verbal feedback for a case interview into a structured, professional evaluation card (HTML format only, no markdown). 
        Use <h3> for sections (Key Strengths, Areas for Improvement) and <ul><li> for points. Keep it encouraging but sharp. 
        Feedback: "${text}"
    `;

    try {
        const response = await fetch('/api/generate-feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: fullPrompt })
        });

        const data = await response.json();
        
        if (data.candidates && data.candidates[0].content) {
              let resultHtml = data.candidates[0].content.parts[0].text;
              resultHtml = resultHtml.replace(/```html/g, '').replace(/```/g, '');
              
              loadingAi.classList.add('hidden');
              aiOutputContent.innerHTML = resultHtml;
              generatedAiFeedback = resultHtml;
              retryFeedbackBtn.classList.remove('hidden');
        } else {
              throw new Error("Invalid response from AI");
        }
    } catch (error) {
        console.error(error);
        loadingAi.classList.add('hidden');
        aiOutputContent.innerHTML = `<span class="text-red-500">Error generating insights. Please try again.</span>`;
        retryFeedbackBtn.classList.remove('hidden');
    }
}

function saveAndCompleteCase() {
    if (!userProfile) {
        alert("Please create a profile to save your progress!");
        loginModal.classList.remove('hidden');
        loginModal.classList.add('flex');
        return;
    }

    // --- RESTORED WEIGHTED RATING LOGIC ---
    let totalScore = 0;
    const scores = {};
    const params = [
        { key: 'structure', weight: 0.35 },
        { key: 'understanding', weight: 0.25 },
        { key: 'delivery', weight: 0.25 },
        { key: 'creativity', weight: 0.15 } // Restored Creativity
    ];

    params.forEach(p => {
        const checked = document.querySelector(`.inline-rating[data-param="${p.key}"] input:checked`);
        const val = checked ? parseInt(checked.value) : 0;
        scores[p.key] = val;
        // Convert 5-star scale to 100-point scale component
        // (Val / 5) * 100 * Weight
        totalScore += (val / 5) * 100 * p.weight;
    });

    // Formatting duration
    const mins = Math.floor(secondsElapsed / 60);
    const secs = secondsElapsed % 60;
    const durationStr = `${mins}m ${secs}s`;

    const record = {
        caseId: currentCase.id,
        name: currentCase.title,
        company: currentCase.company,
        type: currentCase.type,
        difficulty: currentCase.difficulty,
        date: new Date().toISOString().split('T')[0],
        totalScore: Math.round(totalScore),
        duration: durationStr, // Saving Timer Data
        structuring: scores.structure * 6, // Approximate mapping for old dashboard logic
        quantitative: scores.understanding * 3, 
        insight: scores.delivery * 7,
        communication: scores.creativity * 4,
        aiFeedback: generatedAiFeedback || "No verbal feedback recorded."
    };

    // Update User Data & Stats
    if (!userProfile.history) userProfile.history = [];
    userProfile.history.push(record);
    userProfile.stats.solved++;
    
    // Streak Logic (Restored)
    const today = new Date().toDateString();
    const lastActive = userProfile.stats.lastActive ? new Date(userProfile.stats.lastActive).toDateString() : null;
    
    if (lastActive !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (lastActive === yesterday.toDateString()) {
            userProfile.stats.streak++;
        } else {
            userProfile.stats.streak = 1;
        }
        userProfile.stats.lastActive = new Date().toISOString();
    }

    localStorage.setItem('caseBuddyUser', JSON.stringify(userProfile));
    
    showView(views.dashboard);
    initializeDashboard();
}

// --- Modal Logic ---
function openCompanyModal() { companyModal.classList.remove('hidden'); companyModal.classList.add('flex'); }
function closeCompanyModal() { companyModal.classList.remove('flex'); companyModal.classList.add('hidden'); }
function openWarningModal() { warningModal.classList.remove('hidden'); warningModal.classList.add('flex');}
function closeWarningModal() { warningModal.classList.remove('flex'); warningModal.classList.add('hidden');}

function applyCompanySelection() {
    selectedCompanies = Array.from(companyListContainer.querySelectorAll('.company-checkbox:checked')).map(cb => cb.value);
    if (selectedCompanies.length === 0) companyCountEl.textContent = 'All companies selected';
    else companyCountEl.textContent = `${selectedCompanies.length} companies selected`;
    closeCompanyModal();
}

// --- User Profile / Login System ---
function initLoginSystem() {
    renderNav();
    if (!userProfile && !sessionStorage.getItem('loginSkipped')) {
        setTimeout(openLoginModal, 1500);
    }
}

function renderNav() {
    navActionsContainer.innerHTML = ''; 

    if (userProfile) {
        const mascot = mascots[userProfile.mascotId] || mascots[0];
        
        const pillContainer = document.createElement('div');
        pillContainer.className = 'user-pill-container relative py-2';
        pillContainer.innerHTML = `
            <div class="user-pill flex items-center gap-3 pl-1 pr-4 py-1.5 bg-white border border-slate-200 rounded-full cursor-pointer shadow-sm">
                <div class="w-8 h-8 rounded-full flex items-center justify-center p-1.5" style="background-color: ${mascot.color}15; color: ${mascot.color};">
                    ${commonAvatarSvg}
                </div>
                <div class="flex flex-col leading-none">
                    <span class="text-xs font-bold text-slate-700">${userProfile.username}</span>
                </div>
            </div>
        `;
        pillContainer.addEventListener('click', renderUserProfile);
        navActionsContainer.appendChild(pillContainer);

        const dashboardBtn = document.createElement('button');
        dashboardBtn.textContent = 'Dashboard';
        dashboardBtn.className = 'text-slate-600 hover:text-blue-600 font-semibold transition-colors text-sm';
        dashboardBtn.addEventListener('click', () => showView(views.dashboard));

        const aboutBtn = document.createElement('button');
        aboutBtn.textContent = 'About';
        aboutBtn.className = 'text-slate-600 hover:text-blue-600 font-semibold transition-colors text-sm';
        aboutBtn.addEventListener('click', () => showView(views.about));

        navActionsContainer.appendChild(dashboardBtn);
        navActionsContainer.appendChild(aboutBtn);

    } else {
        const loginBtn = document.createElement('button');
        loginBtn.textContent = 'Login / Sign Up';
        loginBtn.className = 'text-sm font-bold text-white bg-slate-900 px-4 py-2 rounded-lg hover:bg-slate-800 transition';
        loginBtn.addEventListener('click', openLoginModal);
        navActionsContainer.appendChild(loginBtn);
    }
}

function renderUserProfile() {
    if(!userProfile) return;
    const mascot = mascots[userProfile.mascotId] || mascots[0];
    const stats = userProfile.stats || { solved: 0, streak: 0 };
    const history = userProfile.history || [];
    const avgScore = history.length > 0 ? Math.round(history.reduce((a, b) => a + b.totalScore, 0) / history.length) : 0;

    // Use the original Aesthetic layout with Neo-cards
    views.profile.innerHTML = `
        <div class="max-w-4xl mx-auto py-8 dashboard-animate-fade-in">
            <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 mb-8 flex flex-col md:flex-row items-center gap-8">
                <div class="w-32 h-32 rounded-full flex items-center justify-center p-6 shadow-inner" 
                     style="background-color: ${mascot.color}10; color: ${mascot.color};">
                    ${commonAvatarSvg}
                </div>
                <div class="text-center md:text-left flex-grow">
                    <h1 class="text-3xl font-extrabold text-slate-800 mb-1">${userProfile.name}</h1>
                    <p class="text-slate-500 font-medium text-sm mb-4">@${userProfile.username} • ${userProfile.college}</p>
                    <div class="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600">
                        Member since ${new Date(userProfile.joinedDate).toLocaleDateString()}
                    </div>
                </div>
                <div class="text-right">
                    <button onclick="logout()" class="text-red-500 hover:text-red-700 font-semibold text-sm border border-red-100 hover:bg-red-50 px-4 py-2 rounded-lg transition">Log Out</button>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                <div class="neo-card p-6 bg-neo-pink border-red-100">
                    <p class="text-xs font-bold uppercase opacity-70 mb-1">Cases Cracked</p>
                    <p class="text-4xl neo-stat-value">${stats.solved}</p>
                </div>
                <div class="neo-card p-6 bg-neo-cream border-yellow-100">
                    <p class="text-xs font-bold uppercase opacity-70 mb-1">Current Streak</p>
                    <p class="text-4xl neo-stat-value">${stats.streak} <span class="text-lg">days</span></p>
                </div>
                <div class="neo-card p-6 bg-neo-dark">
                    <p class="text-xs font-bold uppercase opacity-70 mb-1">Average Score</p>
                    <p class="text-4xl neo-stat-value text-green-400">${avgScore}</p>
                </div>
            </div>

            <h3 class="text-xl font-bold text-slate-800 mb-4 px-2">Recent Activity</h3>
            <div class="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                ${history.length === 0 
                    ? `<div class="p-8 text-center text-slate-400">No cases solved yet. Go crack one!</div>`
                    : `<table class="w-full text-left">
                        <thead class="bg-slate-50 text-xs text-slate-500 uppercase"><tr class="border-b"><th class="p-4">Date</th><th class="p-4">Case</th><th class="p-4">Score</th></tr></thead>
                        <tbody class="divide-y divide-slate-100">
                            ${history.slice().reverse().map(h => `
                                <tr class="hover:bg-slate-50 transition">
                                    <td class="p-4 text-sm text-slate-500">${h.date}</td>
                                    <td class="p-4 font-medium text-slate-700">${h.name}</td>
                                    <td class="p-4 font-bold ${h.totalScore >= 85 ? 'text-green-600' : 'text-slate-600'}">${h.totalScore}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                       </table>`
                }
            </div>
        </div>
    `;
    showView(views.profile);
}

function openLoginModal() {
    mascotContainer.innerHTML = mascots.map((m) => `
        <div class="mascot-option w-16 h-16 rounded-full bg-white flex items-center justify-center cursor-pointer" 
             style="--mascot-color: ${m.color}; --mascot-shadow: ${m.shadow}; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);"
             data-id="${m.id}" onclick="selectMascot(this, ${m.id})">
            <div style="width: 2.5rem; height: 2.5rem; color: ${m.color};">${commonAvatarSvg}</div>
        </div>
    `).join('');
    selectMascot(mascotContainer.children[0], 0);
    loginModal.classList.remove('hidden');
    loginModal.classList.add('flex');
}

window.selectMascot = function(el, id) {
    Array.from(mascotContainer.children).forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    mascotInput.value = id;
}

window.logout = function() {
    if(confirm("Are you sure?")) {
        localStorage.removeItem('caseBuddyUser');
        userProfile = null;
        renderNav();
        showView(views.welcome);
    }
}

// --- Initial Load & Event Listeners ---
document.addEventListener('DOMContentLoaded', () => { 
    const uniqueTypes = [...new Set(allCases.map(c => c.type))].sort();
    const uniqueDifficulties = [...new Set(allCases.map(c => c.difficulty))].sort();
    
    populateMultiSelectFilters(typeFiltersContainer, uniqueTypes, selectedTypes);
    populateMultiSelectFilters(difficultyFiltersContainer, uniqueDifficulties, selectedDifficulties);
    populateCompanyModal();
    
    showView(views.welcome);
    initializeDashboard();
    initLoginSystem();

    // Login Form
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        userProfile = {
            name: document.getElementById('user-fullname-input').value,
            username: document.getElementById('user-name-input').value,
            email: document.getElementById('user-email-input').value,
            college: document.getElementById('user-college-input').value,
            mascotId: mascotInput.value,
            joinedDate: new Date().toISOString(),
            history: [],
            stats: { solved: 0, streak: 1, lastActive: new Date().toISOString() }
        };
        localStorage.setItem('caseBuddyUser', JSON.stringify(userProfile));
        loginModal.classList.add('hidden');
        loginModal.classList.remove('flex');
        renderNav();
    });

    skipLoginBtn.addEventListener('click', () => {
        sessionStorage.setItem('loginSkipped', 'true');
        loginModal.classList.add('hidden');
        loginModal.classList.remove('flex');
    });
});

// Navigation
homeButton.addEventListener('click', () => showView(views.welcome));
backToFiltersBtn.addEventListener('click', () => showView(views.welcome));
backToLibraryBtn.addEventListener('click', () => showView(views.library));

// Actions
searchCasesBtn.addEventListener('click', handleSearch);
viewAllBtn.addEventListener('click', () => renderLibraryView(allCases));
doCaseBtn.addEventListener('click', openWarningModal);

// NEW Interview Flow Listeners
endCaseBtn.addEventListener('click', transitionToFeedbackMode);
inlineRecordBtn.addEventListener('click', () => {
    if(isRecording) recognition.stop();
    else recognition.start();
});
retryFeedbackBtn.addEventListener('click', resetInlineFeedbackUI);
saveCompleteBtn.addEventListener('click', saveAndCompleteCase);

// PDF Controls
prevPageBtn.addEventListener('click', onPrevPage);
nextPageBtn.addEventListener('click', onNextPage);
fullscreenBtn.addEventListener('click', toggleFullscreen);

// Modals
openCompanyModalBtn.addEventListener('click', openCompanyModal);
applyCompaniesBtn.addEventListener('click', applyCompanySelection);
companyModal.addEventListener('click', (e) => { if(e.target === companyModal) closeCompanyModal(); });
allCompaniesCheckbox.addEventListener('change', (e) => {
    companyListContainer.querySelectorAll('.company-checkbox').forEach(cb => { cb.checked = e.target.checked; });
});
clearCompaniesBtn.addEventListener('click', () => {
     companyListContainer.querySelectorAll('.company-checkbox').forEach(cb => { cb.checked = false; });
    allCompaniesCheckbox.checked = false;
});
cancelWarningBtn.addEventListener('click', closeWarningModal);
proceedBtn.addEventListener('click', () => { closeWarningModal(); showInProgressView(); });

// ====================================================================
// --- DASHBOARD SCRIPT ---
// ====================================================================

function initializeDashboard() {
    // Use User Data if available, else empty
    const dashboardCaseData = userProfile ? (userProfile.history || []) : [];
    const maxScores = { structuring: 30, quantitative: 15, insight: 35, communication: 20 };

    let analyticalFilters = {};
    let dateRange = { start: null, end: null };

    const calculateWeightedScore = (caseItem) => {
        // If history already has totalScore, use it, else calculate
        if (caseItem.totalScore) return caseItem.totalScore;
        const weights = { structuring: 30, quantitative: 15, insight: 35, communication: 20 };
        return Math.round(Object.keys(weights).reduce((acc, key) => acc + (caseItem[key] / maxScores[key]) * weights[key], 0));
    };
    const getScoreColor = (score) => {
        if (score >= 85) return 'from-green-500 to-green-400';
        if (score >= 70) return 'from-amber-500 to-amber-400';
        return 'from-red-600 to-red-500';
    };
    const getScoreTextColor = (score) => {
        if (score >= 85) return 'text-green-600';
        if (score >= 70) return 'text-amber-600';
        return 'text-red-600';
    };

    function renderDashboard() {
        // Filter logic
        const globallyFilteredCases = dashboardCaseData.filter(c => {
            const caseDate = new Date(c.date);
            const isAfterStart = !dateRange.start || caseDate >= dateRange.start;
            const isBeforeEnd = !dateRange.end || caseDate <= dateRange.end;
            const typeMatch = !analyticalFilters.type || c.type === analyticalFilters.type;
            const difficultyMatch = !analyticalFilters.difficulty || c.difficulty === analyticalFilters.difficulty;
            return isAfterStart && isBeforeEnd && typeMatch && difficultyMatch;
        });

        renderActiveFilters(analyticalFilters);
        renderScoreCard(globallyFilteredCases);
        renderDetailedMetrics(globallyFilteredCases);
        renderBarCharts(globallyFilteredCases);
        renderKeyTakeaways(globallyFilteredCases);
        renderCaseSummary(globallyFilteredCases);
        renderCalendar(dashboardCaseData);
    }

    function renderDateRangePicker() {
        const container = document.getElementById('dashboard-date-picker');
        container.innerHTML = `
            <select id="date-range-type" class="text-sm border-gray-300 rounded-md shadow-sm">
                <option value="all">All Time</option>
                <option value="this_month">This Month</option>
                <option value="last_month">Last Month</option>
                <option value="custom">Custom Range</option>
            </select>
            <div id="custom-range-inputs" class="hidden items-center gap-2">
                <input type="date" id="date-start" class="text-sm border-gray-300 rounded-md shadow-sm"/>
                <input type="date" id="date-end" class="text-sm border-gray-300 rounded-md shadow-sm"/>
            </div>
            <button id="apply-date-range" class="text-sm bg-blue-600 text-white px-3 py-1 rounded-md hover:bg-blue-700">Apply</button>
        `;

        const rangeTypeSelect = document.getElementById('date-range-type');
        const customInputs = document.getElementById('custom-range-inputs');
        
        rangeTypeSelect.addEventListener('change', (e) => {
            customInputs.classList.toggle('hidden', e.target.value !== 'custom');
        });

        document.getElementById('apply-date-range').addEventListener('click', () => {
            const rangeType = rangeTypeSelect.value;
            let start = null, end = null;
            const today = new Date();
            if (rangeType === 'this_month') {
                start = new Date(today.getFullYear(), today.getMonth(), 1);
                end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            } else if (rangeType === 'last_month') {
                start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                end = new Date(today.getFullYear(), today.getMonth(), 0);
            } else if (rangeType === 'custom') {
                const startVal = document.getElementById('date-start').value;
                const endVal = document.getElementById('date-end').value;
                if (startVal && endVal) {
                    start = new Date(startVal);
                    end = new Date(endVal);
                }
            }
            dateRange = { start, end };
            renderDashboard();
        });
    }

    function renderActiveFilters(filters) {
        const container = document.getElementById('dashboard-active-filters');
        const active = Object.entries(filters).filter(([, value]) => value);
        if (active.length === 0) {
            container.innerHTML = '';
            return;
        }
        
        const filterItems = active.map(([key, value]) => `
            <div class="flex items-center bg-blue-200 text-blue-800 text-xs font-semibold px-2 py-1 rounded-full">
                <span class="capitalize">${key}: ${value}</span>
                <button data-key="${key}" class="ml-2 text-blue-600 hover:text-blue-900 clear-filter-btn">&times;</button>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="flex items-center gap-2 mb-4 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                <span class="font-semibold text-sm text-gray-700">Filters Applied:</span>
                ${filterItems}
                <button id="clear-all-filters-btn" class="ml-auto text-sm font-semibold text-blue-600 hover:text-blue-800">Clear All</button>
            </div>
        `;

        document.querySelectorAll('.clear-filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = e.target.dataset.key;
                delete analyticalFilters[key];
                renderDashboard();
            });
        });
        document.getElementById('clear-all-filters-btn').addEventListener('click', () => {
            analyticalFilters = {};
            renderDashboard();
        });
    }

    function renderScoreCard(cases) {
        const container = document.getElementById('dashboard-score-card');
        if(cases.length === 0) {
            container.innerHTML = `<div class="text-gray-400 italic">No data yet</div>`;
            return;
        }
        const score = Math.round(cases.reduce((acc, curr) => acc + calculateWeightedScore(curr), 0) / cases.length);
        container.innerHTML = `
            <div class="${getScoreTextColor(score)}">
                <span class="text-6xl">${score}</span>
                <span class="text-2xl text-gray-400"> / 100</span>
            </div>
        `;
    }

    function renderDetailedMetrics(cases) {
        const container = document.getElementById('dashboard-metric-breakdown');
        let content = '';
        if (cases.length > 0) {
            const avgMetrics = {
                structuring: cases.reduce((acc, c) => acc + c.structuring, 0) / cases.length,
                quantitative: cases.reduce((acc, c) => acc + c.quantitative, 0) / cases.length,
                insight: cases.reduce((acc, c) => acc + c.insight, 0) / cases.length,
                communication: cases.reduce((acc, c) => acc + c.communication, 0) / cases.length,
            };
            const metricData = Object.keys(maxScores).map(key => ({ 
                name: key.charAt(0).toUpperCase() + key.slice(1), 
                score: avgMetrics[key], 
                maxScore: maxScores[key] 
            }));

            const itemsHTML = metricData.map(item => {
                const percentage = Math.round((item.score / item.maxScore) * 100);
                return `
                    <div class="flex items-center">
                        <div class="w-28 text-sm text-gray-600">${item.name}</div>
                        <div class="flex-1 bg-gray-200 rounded-full h-6">
                            <div class="bg-gradient-to-r ${getScoreColor(percentage)} h-6 rounded-full text-white text-xs flex items-center justify-center font-semibold" style="width: ${percentage}%">${percentage}%</div>
                        </div>
                    </div>
                `;
            }).join('');

            content = `<div class="space-y-3">${itemsHTML}</div>`;
        } else {
            content = `<p class="text-gray-500 text-center py-4">Solve a case to see your metrics!</p>`;
        }
        
        container.innerHTML = `
            <div class="bg-white p-4 rounded-lg shadow dashboard-animate-fade-in">
                <h3 class="text-lg font-semibold text-gray-700 mb-4">Metric Breakdown</h3>
                ${content}
            </div>
        `;
    }

    function renderBarCharts(cases) {
        const performanceByGroup = (dataSource, groupingKey) => {
            const groups = {};
            dataSource.forEach(c => {
                const key = c[groupingKey];
                if (!groups[key]) groups[key] = { totalScore: 0, count: 0 };
                groups[key].totalScore += calculateWeightedScore(c);
                groups[key].count++;
            });
            return Object.entries(groups).map(([key, value]) => ({ name: key, score: Math.round(value.totalScore / value.count) })).sort((a, b) => b.score - a.score);
        };

        const performanceByTypeData = performanceByGroup(cases, 'type');
        const performanceByDifficultyData = performanceByGroup(cases, 'difficulty');

        renderSingleBarChart('dashboard-type-chart', 'Performance by Case Type', performanceByTypeData, 'type');
        renderSingleBarChart('dashboard-difficulty-chart', 'Performance by Difficulty', performanceByDifficultyData, 'difficulty');
    }

    function renderSingleBarChart(containerId, title, data, filterType) {
        const container = document.getElementById(containerId);
        let content = '';
        if (data.length > 0) {
            const barsHTML = data.map(item => {
                const isActive = analyticalFilters[filterType] === item.name;
                return `
                    <div class="flex items-center group bar-chart-item" data-type="${filterType}" data-value="${item.name}">
                        <div class="w-24 text-sm text-gray-600">${item.name}</div>
                        <div class="flex-1 bg-gray-200 rounded-full h-6 cursor-pointer transition-all duration-200 ${isActive ? 'ring-2 ring-blue-500' : ''}">
                            <div class="bg-gradient-to-r ${getScoreColor(item.score)} h-6 rounded-full text-white text-xs flex items-center justify-center font-bold" style="width: ${item.score}%">${item.score}</div>
                        </div>
                    </div>
                `;
            }).join('');
            content = `<div class="space-y-2">${barsHTML}</div>`;
        } else {
            content = `<p class="text-sm text-gray-500 text-center py-2">No data yet.</p>`;
        }

        container.innerHTML = `
            <div class="bg-white p-4 rounded-lg shadow">
                <div class="flex justify-between items-baseline mb-2">
                    <h3 class="text-lg font-semibold text-gray-700">${title}</h3>
                    <span class="text-xs text-gray-400 italic">Click bars to filter</span>
                </div>
                ${content}
            </div>
        `;

        document.querySelectorAll(`#${containerId} .bar-chart-item`).forEach(item => {
            item.addEventListener('click', (e) => {
                const current = e.currentTarget;
                const type = current.dataset.type;
                const value = current.dataset.value;
                analyticalFilters[type] = analyticalFilters[type] === value ? undefined : value;
                renderDashboard();
            });
        });
    }

    function renderKeyTakeaways(cases) {
        const container = document.getElementById('dashboard-key-takeaways');
        if (cases.length < 2) {
            container.innerHTML = `<div class="bg-white p-6 rounded-lg shadow lg:col-span-3 text-center text-gray-500">Solve at least 2 cases to unlock insights.</div>`;
            return;
        }

        const getMetricPerformance = (caseSet) => {
            const performance = {};
            Object.keys(maxScores).forEach(key => {
                const avgScore = caseSet.reduce((acc, c) => acc + c[key], 0) / caseSet.length;
                performance[key] = Math.round((avgScore / maxScores[key]) * 100);
            });
            return performance;
        };

        const overallPerf = getMetricPerformance(cases);
        const strength = Object.entries(overallPerf).reduce((max, item) => item[1] > max[1] ? item : max);
        const weakness = Object.entries(overallPerf).reduce((min, item) => item[1] < min[1] ? item : min);

        const types = [...new Set(cases.map(c => c.type))];
        const typeScores = types.map(type => {
            const typeCases = cases.filter(c => c.type === type);
            return { name: type, score: Math.round(typeCases.reduce((acc, c) => acc + calculateWeightedScore(c), 0) / typeCases.length) };
        });
        const bestType = typeScores.reduce((max, item) => item.score > max.score ? item : max, {score: -1});
        const worstType = typeScores.reduce((min, item) => item.score < min.score ? item : min, {score: 101});
        
        container.innerHTML = `
            <div class="bg-white p-6 rounded-lg shadow lg:col-span-3">
                <h2 class="text-xl font-semibold text-gray-700 mb-4">Key Takeaways</h2>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 text-sm">
                    <div class="bg-slate-50 p-4 rounded-lg">
                        <h3 class="font-bold text-gray-800 mb-2 flex items-center">⭐ Your Strength</h3>
                        <p>Your strongest area is <span class="font-bold text-green-600">${strength[0]}</span> with an average performance of <span class="font-bold">${strength[1]}%</span>.</p>
                    </div>
                    <div class="bg-slate-50 p-4 rounded-lg">
                        <h3 class="font-bold text-gray-800 mb-2 flex items-center">🎯 Focus Area</h3>
                        <p>The biggest opportunity for improvement is in <span class="font-bold text-red-600">${weakness[0]}</span>, currently at <span class="font-bold">${weakness[1]}%</span>.</p>
                    </div>
                    <div class="bg-slate-50 p-4 rounded-lg">
                        <h3 class="font-bold text-gray-800 mb-2 flex items-center">🚀 Best Case Type</h3>
                        <p>You excel at <span class="font-bold text-blue-600">${bestType.name}</span> cases, averaging a score of <span class="font-bold">${bestType.score}</span>.</p>
                    </div>
                    <div class="bg-slate-50 p-4 rounded-lg">
                        <h3 class="font-bold text-gray-800 mb-2 flex items-center">🔍 Review Needed</h3>
                        <p>Consider practicing more <span class="font-bold text-orange-600">${worstType.name}</span> cases, where your average score is <span class="font-bold">${worstType.score}</span>.</p>
                    </div>
                </div>
            </div>
        `;
    }

    function renderCaseSummary(cases) {
        const container = document.getElementById('dashboard-case-summary');
        let tableBody = '';
        if (cases.length > 0) {
            tableBody = cases.map(c => `
                <tr class="border-b last:border-none hover:bg-gray-50">
                    <td class="py-3 px-3 text-sm text-gray-600">${c.date}</td>
                    <td class="py-3 px-3">${c.company} - ${c.name}</td>
                    <td class="py-3 px-3"><span class="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full">${c.type}</span></td>
                    <td class="py-3 px-3"><span class="bg-green-100 text-green-800 text-xs font-medium px-2.5 py-0.5 rounded-full">${c.difficulty}</span></td>
                    <td class="py-3 px-3 text-right font-semibold">${calculateWeightedScore(c)}</td>
                </tr>
            `).join('');
        } else {
            tableBody = `<tr><td colspan="5" class="text-center py-8 text-gray-500">No cases match the current filters.</td></tr>`;
        }

        container.innerHTML = `
            <div class="bg-white p-4 rounded-lg shadow">
                <h2 class="text-xl font-semibold text-gray-700 mb-4">Case Summary</h2>
                <div class="overflow-y-auto max-h-80">
                    <table class="w-full text-left">
                        <thead><tr class="border-b text-sm text-gray-500"><th class="py-2 px-3">Date</th><th class="py-2 px-3">Case Name</th><th class="py-2 px-3">Type</th><th class="py-2 px-3">Difficulty</th><th class="py-2 px-3 text-right">Score</th></tr></thead>
                        <tbody>${tableBody}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function renderCalendar(data) {
        const container = document.getElementById('dashboard-calendar-tracker');
        let currentDate = new Date();

        const calendarData = {};
        data.forEach(c => {
            if (!calendarData[c.date]) calendarData[c.date] = { count: 0, totalScore: 0, cases: [] };
            calendarData[c.date].count++;
            calendarData[c.date].totalScore += calculateWeightedScore(c);
            calendarData[c.date].cases.push(c);
        });
        Object.keys(calendarData).forEach(date => {
            calendarData[date].avgScore = Math.round(calendarData[date].totalScore / calendarData[date].count);
        });

        function drawCalendar() {
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const startDay = new Date(year, month, 1).getDay();
            const calendarDays = Array(startDay).fill(null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

            const daysHTML = calendarDays.map((day, index) => {
                let dateStr = '';
                if(day) {
                    const offsetDate = new Date(year, month, day);
                    const y = offsetDate.getFullYear();
                    const m = String(offsetDate.getMonth() + 1).padStart(2, '0');
                    const d = String(offsetDate.getDate()).padStart(2, '0');
                    dateStr = `${y}-${m}-${d}`;
                }
                
                const dayData = dateStr ? calendarData[dateStr] : null;
                let dayContent = '';
                if (dayData) {
                    dayContent = `
                        <div class="text-xs mt-1 space-y-1">
                            <div class="bg-blue-100 text-blue-800 rounded-full px-1">Cases: ${dayData.count}</div>
                            <div class="${getScoreColor(dayData.avgScore).replace('from-', 'bg-').split(' ')[0]} text-white rounded-full px-1">Avg: ${dayData.avgScore}</div>
                        </div>
                    `;
                }
                return `
                    <div class="h-24 border rounded-md p-1 ${day ? (dayData ? 'cursor-pointer hover:bg-slate-100' : '') : 'bg-slate-50'}" data-date="${dateStr}">
                        ${day ? `<div class="font-semibold text-gray-700">${day}</div>` : ''}
                        ${dayContent}
                    </div>
                `;
            }).join('');

            container.innerHTML = `
                <div class="bg-white p-4 rounded-lg shadow">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-xl font-semibold text-gray-700">Progress Calendar</h2>
                        <div class="flex items-center gap-2">
                            <button id="cal-prev" class="px-2 py-1 rounded-md hover:bg-gray-200">&lt;</button>
                            <span class="font-bold w-32 text-center">${currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
                            <button id="cal-next" class="px-2 py-1 rounded-md hover:bg-gray-200">&gt;</button>
                        </div>
                    </div>
                    <div class="grid grid-cols-7 gap-1 text-center text-sm">
                        ${dayNames.map(day => `<div class="font-bold text-gray-500">${day}</div>`).join('')}
                        ${daysHTML}
                    </div>
                </div>
            `;

            document.getElementById('cal-prev').addEventListener('click', () => {
                currentDate.setMonth(currentDate.getMonth() - 1);
                drawCalendar();
            });
            document.getElementById('cal-next').addEventListener('click', () => {
                currentDate.setMonth(currentDate.getMonth() + 1);
                drawCalendar();
            });
            
            container.querySelectorAll('[data-date]').forEach(cell => {
                if (calendarData[cell.dataset.date]) {
                    cell.addEventListener('click', () => showCalendarModal(calendarData[cell.dataset.date]));
                }
            });
        }
        drawCalendar();
    }
    
    function showCalendarModal(dayData) {
        const modal = document.getElementById('calendar-modal');
        const content = document.getElementById('calendar-modal-content');

        const casesHTML = dayData.cases.map(c => `
            <div class="border rounded-lg p-3">
                <p class="font-semibold">${c.company} - ${c.name}</p>
                <div class="flex gap-2 mt-1 text-xs">
                    <span class="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">${c.type}</span>
                    <span class="bg-green-100 text-green-800 px-2 py-0.5 rounded-full">${c.difficulty}</span>
                </div>
            </div>
        `).join('');
        
        content.innerHTML = `
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-gray-800">Cases for ${dayData.cases[0].date}</h3>
                <button id="close-cal-modal" class="text-gray-500 hover:text-gray-800 text-2xl">&times;</button>
            </div>
            <div class="space-y-4">${casesHTML}</div>
        `;
        
        modal.classList.remove('hidden');

        const closeModal = () => modal.classList.add('hidden');
        document.getElementById('close-cal-modal').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    }
    // --- Initial Dashboard Render ---
    renderDateRangePicker();
    renderDashboard();
}
