document.addEventListener('DOMContentLoaded', () => {
  initFaqAccordion();
  initScrollSpy();
  initHeroActions();
});

// 1. FAQ Accordion Toggle Logic
function initFaqAccordion() {
  const faqButtons = document.querySelectorAll('.faq-question');

  faqButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const currentItem = btn.closest('.faq-item');
      const isOpen = currentItem.classList.contains('open');

      // Isara ang iba pang nakabukas na accordion items
      document.querySelectorAll('.faq-item.open').forEach((openItem) => {
        if (openItem !== currentItem) {
          openItem.classList.remove('open');
        }
      });

      // I-toggle ang kasalukuyang item
      currentItem.classList.toggle('open', !isOpen);
    });
  });
}

// 2. Dynamic Navbar Highlighting Habang Nag-i-scroll
function initScrollSpy() {
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a');

  window.addEventListener('scroll', () => {
    let currentSectionId = '';
    const scrollPosition = window.scrollY + 120;

    sections.forEach((section) => {
      const top = section.offsetTop;
      const height = section.offsetHeight;

      if (scrollPosition >= top && scrollPosition < top + height) {
        currentSectionId = section.getAttribute('id');
      }
    });

    navLinks.forEach((link) => {
      link.classList.remove('active');
      const href = link.getAttribute('href');
      if (href === `#${currentSectionId}`) {
        link.classList.add('active');
      }
    });
  });
}

// 3. CTA at Button Event Listeners
function initHeroActions() {
  const ctaBtn = document.querySelector('.cta-btn');
  if (ctaBtn) {
    ctaBtn.addEventListener('click', () => {
      // Pwedeng i-scroll sa menu o i-redirect sa drinks/customizer
      const drinksSection = document.getElementById('drinks');
      if (drinksSection) {
        drinksSection.scrollIntoView({ behavior: 'smooth' });
      } else {
        window.location.href = '#about';
      }
    });
  }
}