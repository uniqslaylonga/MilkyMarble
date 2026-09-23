let currentSelectedRating = 5;
let activeRatingOrderId = 0;
let activeRatingCupTitle = '';

const RATING_LABELS = {
  1: "1.0 - Needs improvement",
  2: "2.0 - Not my sweet match",
  3: "3.0 - Pretty good!",
  4: "4.0 - Loved the sips!",
  5: "5.0 - Super Creamy & Bouncy!"
};

// Open rating modal with selected order details
function openRateModal(orderOrNotifData) {
  if (!orderOrNotifData) return;

  activeRatingOrderId = orderOrNotifData.id || orderOrNotifData.order_id || 0;

  let rawTitle = orderOrNotifData.title || 'Bubbly Coffee Jelly';
  let displayImg = orderOrNotifData.image || '../assets/images/Bubbly Coffee Jelly.png';
  let accent = orderOrNotifData.accent_color || '#664638';
  let size = '12oz';

  if (orderOrNotifData.items && orderOrNotifData.items.length > 0) {
    const firstItem = orderOrNotifData.items[0];
    rawTitle = firstItem.title || rawTitle;
    size = firstItem.size || size;
    displayImg = firstItem.image || displayImg;
    accent = orderOrNotifData.accent_color || firstItem.accent_color || accent;
    if (!activeRatingOrderId && firstItem.order_id) {
      activeRatingOrderId = firstItem.order_id;
    }
  }

  // Clean title prefix and size notation
  const cleanName = rawTitle.replace(/^(8oz|12oz)\s*/i, '')
                            .replace(/\s*\((8oz|12oz)\)/i, '')
                            .replace(/[\(\[\+].*$/, '')
                            .trim();

  activeRatingCupTitle = `${size} ${cleanName}`;

  document.getElementById('rateCupTitle').innerText = activeRatingCupTitle;
  document.getElementById('rateCupImg').src = displayImg;
  document.getElementById('rateCupThumb').style.setProperty('--thumb-accent', accent);

  setStarRating(5);
  document.getElementById('rateReviewText').value = '';
  document.getElementById('charCount').innerText = '0';

  document.getElementById('rateModal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

// Close rating modal
function closeRateModal(event) {
  const modal = document.getElementById('rateModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

// Select star rating score
function setStarRating(rating) {
  currentSelectedRating = rating;
  highlightStars(rating);
  document.getElementById('rateScoreLabel').innerText = RATING_LABELS[rating] || `${rating}.0`;
}

// Temporary highlight on hover
function hoverStarRating(rating) {
  highlightStars(rating);
  document.getElementById('rateScoreLabel').innerText = RATING_LABELS[rating] || `${rating}.0`;
}

// Reset star highlight on mouse leave
function resetHoverStars() {
  highlightStars(currentSelectedRating);
  document.getElementById('rateScoreLabel').innerText = RATING_LABELS[currentSelectedRating];
}

// Update star active styles
function highlightStars(count) {
  const stars = document.querySelectorAll('.rate-stars-container .star-icon');
  stars.forEach((star, index) => {
    star.classList.toggle('active', index < count);
  });
}

// Toggle review tag selection
function toggleRateTag(pill) {
  pill.classList.toggle('active');
}

// Update review character length counter
function updateCharCount(textarea) {
  document.getElementById('charCount').innerText = textarea.value.length;
}

// Submit review to Express backend
async function submitRating() {
  const user = JSON.parse(localStorage.getItem('mm_user') || 'null');

  if (!user || !user.customer_id) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: 'Login Required',
        text: 'Please log in to submit a rating.',
        icon: 'warning'
      });
    } else {
      alert('Please log in to submit a rating.');
    }
    return;
  }

  const activeTags = [];
  document.querySelectorAll('#rateTagsContainer .rate-tag-pill.active').forEach(p => {
    activeTags.push(p.innerText.trim());
  });

  const reviewText = document.getElementById('rateReviewText').value.trim();
  const submitBtn = document.getElementById('btnSubmitRating');

  submitBtn.disabled = true;
  submitBtn.innerText = 'Submitting...';

  try {
    const response = await fetch('/api/ratings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: user.customer_id,
        order_id: activeRatingOrderId,
        product_title: activeRatingCupTitle,
        rating_score: currentSelectedRating,
        tags: activeTags.join(', '),
        review_text: reviewText
      })
    });

    const data = await response.json();

    if (response.ok && data.status === 'success') {
      if (typeof Swal !== 'undefined') {
        await Swal.fire({
          title: 'Review Saved!',
          text: data.message || 'Thank you for your rating!',
          icon: 'success'
        });
      } else {
        alert(data.message || 'Thank you for your rating!');
      }
      closeRateModal();
      location.reload();
    } else {
      throw new Error(data.message || 'Failed to submit rating.');
    }
  } catch (err) {
    console.error('Rating submission failed:', err);
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: 'Error',
        text: err.message || 'Network error while submitting rating.',
        icon: 'error'
      });
    } else {
      alert(err.message || 'Network error while submitting rating.');
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = 'Submit Review';
  }
}