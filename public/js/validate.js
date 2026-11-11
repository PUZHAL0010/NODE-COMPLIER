// public/js/validate.js - Client-side validation script connected to the Express backend

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('emailForm');
  const emailInput = document.getElementById('emailInput');
  const btnSubmit = document.getElementById('btnSubmit');
  const resultDiv = document.getElementById('result');

  if (!form || !emailInput || !btnSubmit || !resultDiv) {
    return;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    if (!email) {
      showResult('error', 'Please enter an email address.');
      return;
    }

    // Set UI to loading state
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Validating...';
    showResult('loading', 'Checking email validity with API...');

    try {
      // Relative URL /validate-email will hit user Express server on port 3001
      // (Intercepted and routed appropriately in preview environment)
      const response = await fetch('/validate-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ email })
      });

      const data = await response.json().catch(() => null);

      if (response.ok && data && data.status === 'success') {
        showResult('success', `✓ ${data.message || 'Email is valid!'}`);

        // Persist to session storage
        try {
          sessionStorage.setItem('validated_email', email);
          sessionStorage.setItem('validated_message', data.message || 'Email is valid!');
        } catch (storageErr) {
          console.warn('Storage warning:', storageErr);
        }

        // Navigate to the Success Page
        const targetUrl = `/views/success.html?email=${encodeURIComponent(email)}&message=${encodeURIComponent(data.message || 'Email is valid!')}`;
        
        setTimeout(() => {
          if (typeof window.navigateTo === 'function') {
            window.navigateTo(targetUrl);
          } else {
            window.location.href = targetUrl;
          }
        }, 300);
      } else {
        const errorMessage = (data && data.message) ? data.message : 'Invalid email address format.';
        showResult('error', `✗ Invalid! ${errorMessage}`);
      }
    } catch (err) {
      console.error('API Fetch error:', err);
      showResult('error', `✗ Error: Could not connect to API route (${err.message || 'Server offline'}). Ensure server is running on port 3001.`);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Validate Email';
    }
  });

  function showResult(type, message) {
    resultDiv.className = `alert alert-${type}`;
    resultDiv.textContent = message;
    resultDiv.style.display = 'block';
  }
});
