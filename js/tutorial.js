// Zola Money Trans - First Time User Tutorial

const tutorialSlides = [
  {
    title: "Bienvenue sur Zola!",
    desc: "Pour commencer, complétez vos documents KYC, attachez votre carte Visa et liez vos comptes Mobile Money.",
    html: `
      <div class="tutorial-icons-row">
        <div class="tutorial-icon">
          <div class="tutorial-icon-circle bg-airtel">Airtel</div>
          <span>Airtel Money</span>
        </div>
        <div class="tutorial-icon">
          <div class="tutorial-icon-circle bg-mpesa">M-Pesa</div>
          <span>M-Pesa</span>
        </div>
        <div class="tutorial-icon">
          <div class="tutorial-icon-circle bg-orange">Orange</div>
          <span>Orange</span>
        </div>
        <div class="tutorial-icon">
          <div class="tutorial-icon-circle bg-afri">Afri</div>
          <span>Afrimoney</span>
        </div>
        <div class="tutorial-icon">
          <div class="tutorial-icon-circle bg-visa" style="font-family: serif; font-style: italic;">VISA</div>
          <span>Carte Visa</span>
        </div>
      </div>
    `,
    icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>`
  },
  {
    title: "Envoyez & Recevez",
    desc: "Envoyez de l'argent à un ami en un clic, ou demandez un paiement facilement. Fonctionne avec tous les opérateurs.",
    html: ``,
    icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 16 4-4-4-4"/><path d="m11 20 4-4-4-4"/><path d="M3 12h18"/></svg>`
  },
  {
    title: "Paiement en Boutique",
    desc: "Payez vos achats en boutique en quelques secondes. Scannez le code QR du marchand ou présentez le vôtre !",
    html: ``,
    icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/></svg>`
  }
];

let currentSlideIndex = 0;

function createTutorialDOM() {
  if (document.getElementById('zola-tutorial-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'zola-tutorial-overlay';
  overlay.className = 'tutorial-overlay';

  const modal = document.createElement('div');
  modal.className = 'tutorial-modal';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tutorial-close-btn';
  closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  closeBtn.onclick = closeTutorial;
  modal.appendChild(closeBtn);

  const slidesContainer = document.createElement('div');
  slidesContainer.id = 'zola-tutorial-slides';

  tutorialSlides.forEach((slide, index) => {
    const slideEl = document.createElement('div');
    slideEl.className = `tutorial-slide ${index === 0 ? 'active' : ''}`;
    slideEl.innerHTML = `
      <div class="tutorial-img">${slide.icon}</div>
      <h2 class="tutorial-title">${slide.title}</h2>
      <p class="tutorial-desc">${slide.desc}</p>
      ${slide.html}
    `;
    slidesContainer.appendChild(slideEl);
  });

  modal.appendChild(slidesContainer);

  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'tutorial-actions';

  const dotsContainer = document.createElement('div');
  dotsContainer.className = 'tutorial-dots';
  dotsContainer.id = 'zola-tutorial-dots';
  
  tutorialSlides.forEach((_, index) => {
    const dot = document.createElement('div');
    dot.className = `tutorial-dot ${index === 0 ? 'active' : ''}`;
    dotsContainer.appendChild(dot);
  });

  actionsContainer.appendChild(dotsContainer);

  const btnContainer = document.createElement('div');
  
  const nextBtn = document.createElement('button');
  nextBtn.id = 'zola-tutorial-next-btn';
  nextBtn.className = 'btn btn-primary tutorial-btn';
  nextBtn.textContent = 'Suivant';
  nextBtn.onclick = nextTutorialSlide;
  
  btnContainer.appendChild(nextBtn);
  actionsContainer.appendChild(btnContainer);

  modal.appendChild(actionsContainer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function nextTutorialSlide() {
  if (currentSlideIndex < tutorialSlides.length - 1) {
    currentSlideIndex++;
    updateTutorialView();
  } else {
    closeTutorial();
  }
}

function updateTutorialView() {
  const slides = document.querySelectorAll('.tutorial-slide');
  const dots = document.querySelectorAll('.tutorial-dot');
  const nextBtn = document.getElementById('zola-tutorial-next-btn');

  slides.forEach((slide, idx) => {
    slide.classList.toggle('active', idx === currentSlideIndex);
  });
  dots.forEach((dot, idx) => {
    dot.classList.toggle('active', idx === currentSlideIndex);
  });

  if (currentSlideIndex === tutorialSlides.length - 1) {
    nextBtn.textContent = 'Commencer';
    nextBtn.classList.remove('btn-primary');
    nextBtn.classList.add('btn-gold');
  } else {
    nextBtn.textContent = 'Suivant';
    nextBtn.classList.remove('btn-gold');
    nextBtn.classList.add('btn-primary');
  }
}

function closeTutorial() {
  const overlay = document.getElementById('zola-tutorial-overlay');
  if (overlay) {
    overlay.classList.remove('show');
    setTimeout(() => {
      overlay.remove();
    }, 300);
  }
  localStorage.setItem('zola_tutorial_seen', 'true');
}

window.showZolaTutorial = function() {
  createTutorialDOM();
  currentSlideIndex = 0;
  updateTutorialView();
  setTimeout(() => {
    document.getElementById('zola-tutorial-overlay').classList.add('show');
  }, 50);
};

// Check on load
document.addEventListener('DOMContentLoaded', () => {
  if (!localStorage.getItem('zola_tutorial_seen')) {
    // Small delay to let dashboard load gracefully
    setTimeout(() => {
      window.showZolaTutorial();
    }, 1000);
  }
});
