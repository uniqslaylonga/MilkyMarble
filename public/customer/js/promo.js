async function validatePromoCode(promoCode, currentSubtotal) {
    try {
        const response = await fetch('/api/promo/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: promoCode,
                subtotal: currentSubtotal
            })
        });

        const data = await response.json();
        return data; 
    } catch (err) {
        console.error('Promo verification error:', err);
        return {
            status: 'error',
            message: 'Unable to connect to promo validation server.'
        };
    }
}