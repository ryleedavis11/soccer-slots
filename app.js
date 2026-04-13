 // ─── CONSTANTS ───────────────────────────────────────────────────────────
        const SELL_RATE = 0.65;
        const HOLO_MULTIPLIER = 3;
        const OFFICE_HOURLY_RATE = 0.01;   // 1% of card value per hour
        const OFFICE_CAP_HOURS = 6;         // earnings freeze after 6h uncollected
        const OFFICE_TOP_N = 10;            // top N cards earn
        const PACK_IMAGES = {
            std: 'https://owffrsfbnpnhdgizamhk.supabase.co/storage/v1/object/public/player-images/Barcelona%20team%20-%20FootyRenders.png',
            pre: 'https://owffrsfbnpnhdgizamhk.supabase.co/storage/v1/object/public/player-images/Erling%20Braut%20Haaland%20-%20FootyRenders%20(1).png',
            elt: 'https://owffrsfbnpnhdgizamhk.supabase.co/storage/v1/object/public/player-images/Neymar%20-%20FootyRenders%20(1).png',
            promo: 'https://owffrsfbnpnhdgizamhk.supabase.co/storage/v1/object/public/player-images/imagefor1sted-removebg-preview.png'
        };
 
        // ─── STATE ───────────────────────────────────────────────────────────────
        let balance = 1000;
        let mySquad = [];
        let currentPull = null;
        let activeTier = null;
        let currentUser = null;
        let isLoginMode = false;
        let lastCollected = null;        // ISO timestamp of last office collection
        let officeTickInterval = null;   // setInterval handle for the office ticker

        let _lockedCardIds = new Set();
        let _lastSaveCheckDate = null;
        let _myPendingTradeIds = [];
 
        // ─── TOAST ───────────────────────────────────────────────────────────────
        function showToast(msg, duration = 4000) {
            const existing = document.querySelector('.toast');
            if (existing) existing.remove();
            const t = document.createElement('div');
            t.className = 'toast';
            t.innerText = msg;
            document.body.appendChild(t);
            requestAnimationFrame(() => { requestAnimationFrame(() => t.classList.add('show')); });
            setTimeout(() => {
                t.classList.remove('show');
                setTimeout(() => t.remove(), 400);
            }, duration);
        }
 
        // ─── LOADING HELPERS ─────────────────────────────────────────────────────
        function showLoading() { document.getElementById('loading-overlay').classList.add('active'); }
        function hideLoading() { document.getElementById('loading-overlay').classList.remove('active'); }
 
        // ─── AUTH MODE TOGGLE ────────────────────────────────────────────────────
        function toggleAuthMode() {
            isLoginMode = !isLoginMode;
            const subtitle = document.getElementById('auth-subtitle');
            const btn = document.getElementById('auth-submit-btn');
            const toggle = document.querySelector('.auth-toggle');
            const usernameField = document.getElementById('field-username');
            clearAuthMessages();
            if (isLoginMode) {
                subtitle.innerText = 'SIGN IN';
                btn.innerText = 'SIGN IN';
                toggle.innerText = "Don't have an account? Register";
                usernameField.style.display = 'none';
            } else {
                subtitle.innerText = 'CREATE ACCOUNT';
                btn.innerText = 'CREATE ACCOUNT';
                toggle.innerText = "Already have an account? Sign In";
                usernameField.style.display = 'block';
            }
        }
 
        function clearAuthMessages() {
            document.getElementById('auth-error').innerText = '';
            document.getElementById('auth-success').innerText = '';
        }
        function setAuthError(msg) { document.getElementById('auth-error').innerText = msg; }
        function setAuthSuccess(msg) { document.getElementById('auth-success').innerText = msg; }
 
        // ─── HANDLE AUTH ─────────────────────────────────────────────────────────
        async function handleAuth() {
            clearAuthMessages();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const username = document.getElementById('username').value.trim();
            if (!email || !password) { setAuthError('Email and password required.'); return; }
            showLoading();
            if (isLoginMode) {
                const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
                if (error) { hideLoading(); setAuthError(error.message); return; }
                currentUser = data.user;
                await loadCloudSave();
                enterGame();
            } else {
                if (!username) { hideLoading(); setAuthError('Username is required.'); return; }
                if (username.length < 3) { hideLoading(); setAuthError('Username must be at least 3 characters.'); return; }
                if (password.length < 6) { hideLoading(); setAuthError('Password must be at least 6 characters.'); return; }
                const { data, error } = await _supabase.auth.signUp({ email, password, options: { data: { username } } });
                if (error) { hideLoading(); setAuthError(error.message); return; }
                const { data: sessionData } = await _supabase.auth.getSession();
                currentUser = sessionData.session?.user || data.user;
                const { data: saveData, error: dbError } = await _supabase
                    .from('user_saves')
                    .upsert({
                        user_id: currentUser.id,
                        email: currentUser.email,
                        username: username,
                        balance: 5000,
                        squad: [],
                        club_value: 0,
                        last_collected: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'user_id' })
                    .select();
                if (dbError) { hideLoading(); setAuthError("Database error: " + dbError.message); return; }
                balance = 5000;
                mySquad = [];
                lastCollected = new Date().toISOString();
                hideLoading();
                enterGame();
            }
        }
 
        // ─── LOGOUT ──────────────────────────────────────────────────────────────
        async function handleLogout() {
            if (!confirm('Log out?')) return;
            await saveGame();
            stopOfficeTicker();
            stopTradePoll();
            await _supabase.auth.signOut();
            currentUser = null; balance = 5000; mySquad = []; lastCollected = null;
            document.getElementById('main-nav').style.display = 'none';
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById('view-login').classList.add('active');
            isLoginMode = true; toggleAuthMode();
            document.getElementById('email').value = '';
            document.getElementById('password').value = '';
            document.getElementById('username').value = '';
        }
 
        // ─── SESSION CHECK ───────────────────────────────────────────────────────
        async function checkExistingSession() {
            showLoading();
            const { data: { session } } = await _supabase.auth.getSession();
            if (session) { currentUser = session.user; await loadCloudSave(); enterGame(); }
            else { hideLoading(); }
        }
 
        // ─── ENTER GAME ──────────────────────────────────────────────────────────
        function enterGame() {
            hideLoading();
            document.getElementById('view-login').classList.remove('active');
            document.getElementById('main-nav').style.display = 'flex';

            setupPresence();

            showView('home');
            updateWelcomeMsg();
            initMarquee();
            startOfficeTicker();
            startTradePoll();
 
            // Show offline earnings toast if any were credited on load
            if (window._offlineEarnedNotif) {
                showToast(`💰 While you were away, your Office earned +${window._offlineEarnedNotif.toLocaleString()} 🪙`);
                window._offlineEarnedNotif = null;
            }
            loadTopPullsToday();
            loadLimitedStock();
            loadExchangeState();
            startPlaytimeTracking();
        }

        async function loadTopPullsToday() {
            const track = document.getElementById('store-pulls-track');
            if (!track) return;
            // Fetch all squads to find today's pulls
            const { data } = await _supabase
                .from('user_saves')
                .select('username, squad')
                .not('squad', 'is', null);
            if (!data) return;

            const todayStr = new Date().toLocaleDateString();
            let todayPulls = [];
            data.forEach(user => {
                (user.squad || []).forEach(card => {
                    if (card.collectedDate === todayStr) {
                        todayPulls.push({ ...card, pulledBy: user.username || 'ANONYMOUS' });
                    }
                });
            });

            // Sort by market value desc, take top 10
            todayPulls.sort((a, b) => getCardValue(b) - getCardValue(a));
            const top10 = todayPulls.slice(0, 10);

            if (top10.length === 0) {
                // Fallback: show random high-rated cards so the marquee isn't empty
                const { data: fallback } = await _supabase.from('soccer_stars').select('*').gte('rating', 88).limit(10);
                if (fallback) {
                    track.innerHTML = [...fallback, ...fallback].map(p =>
                        `<div class="store-pull-item">${generateCardHtml(p, false)}<div class="store-pull-username">TODAY'S PULLS</div></div>`
                    ).join('');
                }
                return;
            }

            // Duplicate for seamless loop
            const items = [...top10, ...top10].map(p =>
                `<div class="store-pull-item">${generateCardHtml(p, false)}<div class="store-pull-username">${p.pulledBy}</div></div>`
            ).join('');
            track.innerHTML = items;
        }
 
        function updateWelcomeMsg() {
            const username = currentUser?.user_metadata?.username || currentUser?.email || 'MANAGER';
            document.getElementById('welcome-msg').innerText = `WELCOME BACK, ${username.toUpperCase()}`;
        }
 
        // ─── CLOUD SAVE ──────────────────────────────────────────────────────────
        // ─── CLOUD SAVE ──────────────────────────────────────────────────────────
        async function loadCloudSave() {
            if (!currentUser) return;
            const { data, error } = await _supabase
                .from('user_saves')
                .select('balance, squad, last_collected, completed_exchanges, hours_played, last_daily_collect')
                .eq('user_id', currentUser.id)
                .single();
            
            // 🚨 THE SAFETY NET: If the database crashes, stop everything and warn the user!
            if (error) {
                console.error("CRITICAL LOAD ERROR:", error.message);
                showToast('🚨 Database Error! Check console. DO NOT SAVE.', 10000);
                return; 
            }

            if (data) {
                balance = data.balance ?? 5000;
                mySquad = data.squad || [];
                completedExchanges = data.completed_exchanges || [];
                _totalHoursPlayed  = data.hours_played || 0;
                lastCollected = data.last_collected || new Date().toISOString();
                _lastSaveCheckDate = data.updated_at;
            updateLockedCards();
 
                // ── OFFLINE EARNINGS: credit coins for real time spent away ──
                const offlineRoster = [...mySquad]
                    .sort((a, b) => getCardValue(b) - getCardValue(a))
                    .slice(0, OFFICE_TOP_N);
                const offlineHourlyRate = offlineRoster.reduce((sum, p) => sum + getCardValue(p) * OFFICE_HOURLY_RATE, 0);
                const offlineEarned = Math.floor(offlineHourlyRate * getElapsedHours());
                if (offlineEarned > 0) {
                    balance += offlineEarned;
                    lastCollected = new Date().toISOString();
                    window._offlineEarnedNotif = offlineEarned;
                }
 
                updateUI();
                renderSquad();
                saveGame();
            }
        }
 
        async function saveGame() {
            if (!currentUser) return;
            await flushPlaytime();
            // Club value = top 10 by market value (Fix 5)
            const cv = [...mySquad]
                .sort((a,b) => getCardValue(b) - getCardValue(a))
                .slice(0, 10)
                .reduce((sum, p) => sum + getCardValue(p), 0);
            await _supabase
                .from('user_saves')
                .upsert({
                    user_id: currentUser.id,
                    email: currentUser.email,
                    username: currentUser.user_metadata?.username || currentUser.email.split('@')[0],
                    balance,
                    squad: mySquad,
                    club_value: cv,
                    last_collected: lastCollected,
                    completed_exchanges: completedExchanges,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'user_id' });
        }

        // ── LOCK CARDS IN ACTIVE TRADES ──────────────────────────────────────────
        async function updateLockedCards() {
            if (!currentUser) return;
            
            // 1. Fetch any active trade where you are the sender OR the receiver
            const { data } = await _supabase.from('trades')
                .select('offered_card, receiver_card')
                .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`)
                .in('status', ['open', 'pending']);
            
            // 2. Clear the old list and build a fresh one
            _lockedCardIds.clear();
            
            if (data) {
                data.forEach(t => {
                    // Lock Player 1's card
                    if (t.offered_card?.instanceId) {
                        _lockedCardIds.add(t.offered_card.instanceId);
                    }
                    // Lock Player 2's card (if they have offered one)
                    if (t.receiver_card?.instanceId) {
                        _lockedCardIds.add(t.receiver_card.instanceId);
                    }
                });
            }
        }
 
        // ─── GAME LOGIC ──────────────────────────────────────────────────────────
        function getCardValue(p) {
            let val = p.base_price || 0;
            if (p.isSuperHolo) val *= HOLO_MULTIPLIER;
            return val;
        }

        // Exchange cards have market value but ZERO quick sell value
        function getSellValue(p) {
            if ((p.rarity || '').toLowerCase() === 'exchange' || p.isExchange) return 0;
            return Math.floor(getCardValue(p) * SELL_RATE);
        }
 
        // ─── OFFICE PASSIVE INCOME ────────────────────────────────────────────────
 
        /** Returns the top OFFICE_TOP_N cards sorted by value descending */
        function getOfficeRoster() {
            return [...mySquad]
                .sort((a, b) => getCardValue(b) - getCardValue(a))
                .slice(0, OFFICE_TOP_N);
        }
 
        /** Total hourly earn rate across office roster */
        function getOfficeHourlyTotal() {
            return getOfficeRoster().reduce((sum, p) => sum + getCardValue(p) * OFFICE_HOURLY_RATE, 0);
        }
 
        /**
         * How many hours of earnings are currently pending,
         * capped at OFFICE_CAP_HOURS.
         */
        function getElapsedHours() {
            if (!lastCollected) return 0;
            const diffMs = Date.now() - new Date(lastCollected).getTime();
            const diffHours = diffMs / (1000 * 60 * 60);
            return Math.min(diffHours, OFFICE_CAP_HOURS);
        }
 
        /** Pending coin amount right now */
        function getPendingEarnings() {
            return Math.floor(getOfficeHourlyTotal() * getElapsedHours());
        }
 
        /** Is income currently frozen (hit the 6h cap)? */
        function isOfficeCapped() {
            if (!lastCollected) return false;
            const diffMs = Date.now() - new Date(lastCollected).getTime();
            return diffMs >= OFFICE_CAP_HOURS * 60 * 60 * 1000;
        }
 
        /** Collect pending earnings */
        async function collectOfficeEarnings() {
            const earned = getPendingEarnings();
            if (earned <= 0) return;
            balance += earned;
            lastCollected = new Date().toISOString();
            updateUI();
            updateOfficePanelUI();
            await saveGame();
 
            // Flash the panel green briefly
            const panel = document.getElementById('office-collect-panel');
            panel.classList.add('collect-flash');
            setTimeout(() => panel.classList.remove('collect-flash'), 600);
        }
 
        /** Update the collect panel text, bar, button state */
        function updateOfficePanelUI() {
            const roster = getOfficeRoster();
            if (roster.length === 0) {
                document.getElementById('office-pending-display').innerText = '0';
                document.getElementById('office-pending-sub').innerText = '🪙 collect cards to start earning';
                document.getElementById('office-timer-bar').style.width = '0%';
                document.getElementById('office-timer-label').innerText = 'No cards in your squad yet';
                const btn = document.getElementById('office-collect-btn');
                btn.className = 'office-collect-btn empty';
                btn.innerText = 'COLLECT';
                document.getElementById('office-badge').style.display = 'none';
                return;
            }
 
            const pending = getPendingEarnings();
            const elapsed = getElapsedHours();
            const capped = isOfficeCapped();
            const hourlyTotal = getOfficeHourlyTotal();
 
            // Timer bar: 100% = cap reached
            const pct = (elapsed / OFFICE_CAP_HOURS) * 100;
            const bar = document.getElementById('office-timer-bar');
            bar.style.width = pct + '%';
            bar.style.background = capped
                ? 'linear-gradient(90deg, #ef4444, #ff6b6b)'
                : 'linear-gradient(90deg, #3ecf8e, #ffd700)';
 
            // Timer label
            let timerText = '';
            if (capped) {
                timerText = '⚠ INCOME PAUSED — 6 HOUR CAP REACHED';
            } else {
                const remaining = OFFICE_CAP_HOURS - elapsed;
                const rh = Math.floor(remaining);
                const rm = Math.floor((remaining - rh) * 60);
                timerText = `Income freezes in ${rh}h ${rm}m · ${hourlyTotal.toLocaleString(undefined, {maximumFractionDigits: 0})} 🪙/hr`;
            }
            document.getElementById('office-timer-label').innerText = timerText;
 
            // Pending amount
            document.getElementById('office-pending-display').innerText = pending.toLocaleString();
            document.getElementById('office-pending-sub').innerText = capped
                ? '🪙 MAX REACHED — collect to resume earning'
                : `🪙 earning ${(hourlyTotal).toLocaleString(undefined, {maximumFractionDigits: 0})} per hour`;
 
            // Collect button
            const btn = document.getElementById('office-collect-btn');
            if (pending > 0) {
                btn.className = capped ? 'office-collect-btn capped' : 'office-collect-btn ready';
                btn.innerText = `COLLECT +${pending.toLocaleString()} 🪙`;
            } else {
                btn.className = 'office-collect-btn empty';
                btn.innerText = 'COLLECT';
            }
 
            // Nav badge: show if any pending OR capped
            const badge = document.getElementById('office-badge');
            badge.style.display = pending > 0 ? 'flex' : 'none';
        }
 
        /** Render the 10-player earning roster using real card HTML */
        function renderOfficeRoster() {
            const roster = getOfficeRoster();
            const container = document.getElementById('office-roster');
            const capped = isOfficeCapped();
 
            if (roster.length === 0) {
                container.innerHTML = `
                    <div class="office-empty-state">
                        <div class="big-icon">📋</div>
                        <p>KEEP CARDS FROM THE STORE TO START EARNING</p>
                    </div>`;
                return;
            }
 
            const hourlyTotal = getOfficeHourlyTotal();
            let html = `
                <div class="office-roster-title">
                    TOP ${roster.length} EARNERS &nbsp;·&nbsp; ${hourlyTotal.toLocaleString(undefined, {maximumFractionDigits: 0})} 🪙 / HOUR TOTAL
                    ${capped ? '&nbsp;&nbsp;<span style="color:#ef4444">⚠ INCOME PAUSED — COLLECT NOW</span>' : ''}
                </div>
                <div class="office-card-grid">`;
 
            roster.forEach((p, i) => {
                const hourly = getCardValue(p) * OFFICE_HOURLY_RATE;
                html += `
                    <div class="office-card-wrap ${capped ? 'capped' : ''}">
                        <div class="office-rank-badge ${i < 3 ? 'top3' : ''}">#${i + 1}</div>
                        ${generateCardHtml(p, false)}
                        <div class="office-earn-tag ${capped ? 'capped' : ''}">
                            <div class="office-earn-amount">${capped ? '⏸' : '+'} ${hourly.toLocaleString(undefined, {maximumFractionDigits: 1})} 🪙</div>
                            <div class="office-earn-label">${capped ? 'PAUSED' : 'PER HOUR'}</div>
                        </div>
                    </div>`;
            });
 
            html += `</div>`;
            container.innerHTML = html;
        }
 
        /** Render the full office view (called when tab opened + on tick) */
        function renderOfficeView() {
            updateOfficePanelUI();
            renderOfficeRoster();
        }
 
        /** Start the 1-second tick to update pending earnings live */
        function startOfficeTicker() {
            stopOfficeTicker();
            stopTradePoll();
            officeTickInterval = setInterval(() => {
                // Always update the nav badge
                const pending = getPendingEarnings();
                const badge = document.getElementById('office-badge');
                badge.style.display = (pending > 0 && mySquad.length > 0) ? 'flex' : 'none';
 
                // Update panel if office view is open
                const officeView = document.getElementById('view-office');
                if (officeView.classList.contains('active')) {
                    updateOfficePanelUI();
                }
            }, 5000); // tick every 5s (no need for 1s since earnings accumulate slowly)
        }
 
        function stopOfficeTicker() {
            if (officeTickInterval) { clearInterval(officeTickInterval); officeTickInterval = null; }
        }
 
        // ─── MARQUEE ─────────────────────────────────────────────────────────────
        async function initMarquee() {
            const track = document.getElementById('marquee-track');
            const { data } = await _supabase.from('soccer_stars').select('*').gte('rating', 85);
            if (data) { track.innerHTML = [...data, ...data].map(p => generateCardHtml(p, false)).join(''); }
        }
 
        // ─── PACK LOGIC ───────────────────────────────────────────────────────────
        function preparePack(tier) {
            activeTier = tier;
            document.getElementById('packArea').style.display = 'none';
            document.getElementById('default-message').style.display = 'none';
            let specialLayer = '';
            if (tier === 'elt') { specialLayer = '<div class="galaxy-nebula"></div>'; }
            else if (tier === 'promo') { specialLayer = '<div class="promo-fire"></div>'; }
            else if (tier === 'pre') { specialLayer = '<div class="premium-glow"></div>'; }
            const visual = document.getElementById('pack-visual');
            visual.innerHTML = `
                <div class="pack-container" onclick="openPack()">
                   <div class="info-btn" onclick="event.stopPropagation(); showPackWeights('${tier}');" 
                    style="position: absolute; top: -10px; right: -10px; z-index: 20; cursor: pointer; background: #111; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; border: 2px solid #3ecf8e; color: #3ecf8e; font-weight: bold; box-shadow: 0 0 10px rgba(62, 207, 142, 0.3);">
                        i
                     </div>
                   
                        <div class="foil-pack">
                        ${specialLayer}
                        <div class="foil-shine"></div>
                        <div class="pack-label">${tier.toUpperCase()}</div>
                        <img src="${PACK_IMAGES[tier]}" class="sealed-player-render">
                    </div>
                </div>
                <button class="btn" style="background:#333; font-size:0.7rem;" onclick="resetUI()">← CANCEL</button>`;
            visual.style.display = 'block';
        }
 
        async function openPack() {
            const costs = { std: 500, pre: 2500, elt: 10000, promo: 15000 };
            if (balance < costs[activeTier]) { alert("Not enough balance!"); return; }
            balance -= costs[activeTier];
            const roll = Math.random() * 100;
            const limitedOdds = { std: 0, pre: 0.01, elt: 0.1, promo: 0.2 };
            let pulledPlayer = null;
 
            if (Math.random() * 100 < limitedOdds[activeTier]) {
                const { data: limitedPool } = await _supabase.from('soccer_stars').select('*').ilike('rarity', 'Limited');
                if (limitedPool && limitedPool.length > 0) {
                    let potential = limitedPool[Math.floor(Math.random() * limitedPool.length)];
                    const { data: countData } = await _supabase.rpc('count_limited_player', { pid: potential.id });
                    if ((countData || 0) < 10) { pulledPlayer = potential; pulledPlayer.serial = (countData || 0) + 1; }
                }
            }

                // PUT THIS RIGHT AFTER YOUR LIMITED ROLL FINISHES:
                if (!pulledPlayer && activeTier === 'promo') {
                    if (roll < 20) { // 20% chance to hit the promo card
                        const promoRatingRoll = Math.random() * 100;
        let pMin, pMax;

        if (promoRatingRoll < 60)       { pMin = 80; pMax = 86; } // 60% chance for lower tier
        else if (promoRatingRoll < 90)  { pMin = 87; pMax = 89; } // 30% chance for mid tier
        else                            { pMin = 90; pMax = 99; } // 10% chance for "God Tier"

        let { data: promoPool } = await _supabase
            .from('soccer_stars')
            .select('*')
            .ilike('rarity', '1st edition')
            .gte('rating', pMin)
            .lte('rating', pMax)
            .eq('in_packs', true);
        
        // Safety Fallback: If your specific rating bracket is empty, grab ANY 1st edition
        if (!promoPool || promoPool.length === 0) {
            const fallbackPool = await _supabase.from('soccer_stars').select('*').ilike('rarity', '1st edition').eq('in_packs', true);
            promoPool = fallbackPool.data;
        }
                        if (promoPool && promoPool.length > 0) {
                        pulledPlayer = promoPool[Math.floor(Math.random() * promoPool.length)];
                }
            }
}   
 
            if (!pulledPlayer) {
                let minR, maxR;
                if (activeTier === 'std') {
                    if (roll < 50)       { minR = 70; maxR = 79; }
                    else if (roll < 80)  { minR = 80; maxR = 82; }
                    else if (roll < 90)  { minR = 83; maxR = 83; }
                    else if (roll < 95)  { minR = 84; maxR = 85; }
                    else if (roll < 98)  { minR = 86; maxR = 86; }
                    else if (roll < 99.5){ minR = 87; maxR = 89; }
                    else                 { minR = 90; maxR = 99; }
                } else if (activeTier === 'pre') {
                    if (roll < 50)       { minR = 80; maxR = 82; }
                    else if (roll < 70)  { minR = 83; maxR = 83; }
                    else if (roll < 80)  { minR = 84; maxR = 85; }
                    else if (roll < 90)  { minR = 86; maxR = 86; }
                    else if (roll < 95)  { minR = 87; maxR = 88; }
                    else if (roll < 99)  { minR = 89; maxR = 89; }
                    else                 { minR = 90; maxR = 99; }
                } else if (activeTier === 'promo') {
                    if (roll < 50)       { minR = 84; maxR = 86; }
                    else if (roll < 70)  { minR = 87; maxR = 87; }
                    else if (roll < 87)  { minR = 88; maxR = 88; }
                    else if (roll < 97)  { minR = 89; maxR = 89; }
                    else                 { minR = 90; maxR = 99; }

                // --- ELITE PACK GOES LAST AS THE CATCH-ALL ---
                } else {
                    if (roll < 50)       { minR = 84; maxR = 86; }
                    else if (roll < 70)  { minR = 87; maxR = 87; }
                    else if (roll < 87)  { minR = 88; maxR = 88; }
                    else if (roll < 97)  { minR = 89; maxR = 89; }
                    else                 { minR = 90; maxR = 99; }
                }
// ...
                let { data } = await _supabase.from('soccer_stars').select('*').gte('rating', minR).lte('rating', maxR).neq('rarity', 'Limited').neq('rarity', '1st edition').eq('in_packs', true);
                if (!data || data.length === 0) { let fallback = await _supabase.from('soccer_stars').select('*').limit(20); data = fallback.data; }
                pulledPlayer = data[Math.floor(Math.random() * data.length)];
            }
 
            currentPull = pulledPlayer;
            currentPull.instanceId = "inst_" + Date.now();
            currentPull.collectedDate = new Date().toLocaleDateString();
            if (currentPull.rating >= 85 && Math.random() < 0.02) { currentPull.isSuperHolo = true; }

            // If limited — broadcast to everyone else BEFORE showing our own animation
            if (currentPull.rarity && currentPull.rarity.toLowerCase() === 'limited' && _roomChannel) {
                try {
                    await _roomChannel.send({
                        type: 'broadcast',
                        event: 'limited_pull',
                        payload: {
                            packerId:  currentUser.id,
                            username:  currentUser.user_metadata?.username || currentUser.email?.split('@')[0] || 'A MANAGER',
                            cardName:  currentPull.name,
                            serial:    currentPull.serial || '?',
                            cardData:  currentPull
                        }
                    });
                } catch(e) { /* non-critical */ }
            }

            const packVisual = document.getElementById('pack-visual');
                        
                        // Check for Promo Card Animation first

                        if (currentPull.rarity.toLowerCase() === 'limited') {
                            packVisual.classList.add('suspense-shake-limited'); 
                            await new Promise(resolve => setTimeout(resolve, 5000)); 
    
                            const flash = document.createElement('div');
                            flash.className = 'limited-flash'; 
                            document.body.appendChild(flash);
                            setTimeout(() => flash.remove(), 2000);
    
                            packVisual.classList.remove('suspense-shake-limited');
                        }
                        else if (currentPull.rarity.toLowerCase() === '1st edition') {
                            packVisual.classList.add('suspense-shake-promo'); // The intense red shake
                            await new Promise(resolve => setTimeout(resolve, 2500)); // Longer wait for hype
                            
                            const flash = document.createElement('div');
                            flash.className = 'promo-flash'; // The fiery flash
                            document.body.appendChild(flash);
                            setTimeout(() => flash.remove(), 1500);
                            
                            packVisual.classList.remove('suspense-shake-promo');
                        } 
                        // Standard Walkout (for high-rated gold/limited cards)
                        else if (currentPull.rating > 86) {
                            packVisual.classList.add('suspense-shake');
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            
                            const flash = document.createElement('div');
                            flash.className = 'walkout-flash';
                            document.body.appendChild(flash);
                            setTimeout(() => flash.remove(), 1500);
                            
                            packVisual.classList.remove('suspense-shake');
                        }
 
            const val = getCardValue(currentPull);
            const reveal = document.getElementById('pack-reveal');
            reveal.innerHTML = generateCardHtml(currentPull, false);
            packVisual.style.display = 'none';
            reveal.style.display = 'block';
            document.getElementById('choiceArea').style.display = 'flex';
            document.getElementById('sellBtn').innerText = `SELL (+${Math.floor(val * SELL_RATE)})`;
            updateUI();
            await saveGame();
        }
 
        // ─── LEADERBOARD ─────────────────────────────────────────────────────────
        const BANNED_USERNAMES = ['yleer']; // testing accounts hidden from rankings (Fix 7)
        let _lbData = []; // cache for squad viewer

        async function loadLeaderboard() {
            const podium = document.getElementById('podium-area');
            const list   = document.getElementById('leaderboard-container');
            podium.innerHTML = '<p style="color:#555">FETCHING DATA...</p>';
            list.innerHTML   = '';

            const { data, error } = await _supabase
                .from('user_saves')
                .select('username, club_value, squad')
                .order('club_value', { ascending: false })
                .limit(50); // fetch extra so banning doesn't shrink list below 25
            if (error) return;

            // Filter out banned accounts
            const filtered = (data || []).filter(u =>
                !BANNED_USERNAMES.includes((u.username || '').toLowerCase())
            ).slice(0, 25);

            _lbData = filtered;

            // ── Podium (top 3) ──────────────────────────────────────────────
            let podiumHtml = '';
            for (let i = 0; i < Math.min(3, filtered.length); i++) {
                const user = filtered[i];
                let starCard = { name: "No Cards", position: "-", rating: 0, rarity: "common", image_url: '' };
                if (user.squad && user.squad.length > 0) {
                    const showcaseCard = user.squad.find(c => c.isShowcase);
                    const favCard      = user.squad.find(c => c.isFavorite);
                    starCard = showcaseCard || favCard || user.squad.reduce((prev, curr) =>
                        getCardValue(curr) > getCardValue(prev) ? curr : prev);
                }
                podiumHtml += `
                    <div class="podium-slot slot-${i + 1} clickable" onclick="openSquadViewer(${i})"
                         title="View ${user.username || 'ANONYMOUS'}'s squad">
                        <div class="podium-user">#${i + 1} ${user.username || 'ANONYMOUS'}</div>
                        <div class="podium-val">${user.club_value.toLocaleString()} 🪙</div>
                        <div class="podium-star-label"></div>
                        <div class="podium-card-mini">
                            ${user.squad && user.squad.length > 0
                                ? generateCardHtml(starCard, false)
                                : '<div style="height:100px;color:#333">EMPTY</div>'}
                        </div>
                    </div>`;
            }
            podium.innerHTML = podiumHtml;

            // ── Table (4–25) ────────────────────────────────────────────────
            let tableHtml = `<table class="rank-table">
                <tr><th>Rank</th><th>Manager</th><th>Club Value</th><th></th></tr>`;
            for (let i = 3; i < filtered.length; i++) {
                const u = filtered[i];
                tableHtml += `
                    <tr class="rank-row-clickable" onclick="openSquadViewer(${i})">
                        <td>#${i + 1}</td>
                        <td>${u.username || 'ANONYMOUS'}</td>
                        <td style="color:#ffd700;font-weight:bold;">${u.club_value.toLocaleString()} 🪙</td>
                        <td class="view-col">VIEW</td>
                    </tr>`;
            }
            list.innerHTML = tableHtml + '</table>';
        }

        function openSquadViewer(idx) {
            const user = _lbData[idx];
            if (!user) return;
            document.getElementById('sv-title').innerText    = (user.username || 'ANONYMOUS') + "'S SQUAD";
            document.getElementById('sv-subtitle').innerText =
                `${(user.squad || []).length} cards · Club value: ${user.club_value.toLocaleString()} 🪙`;
            const grid = document.getElementById('sv-grid');
            if (!user.squad || user.squad.length === 0) {
                grid.innerHTML = '<div class="sv-empty">This manager has no cards yet.</div>';
            } else {
                const sorted = [...user.squad].sort((a, b) => getCardValue(b) - getCardValue(a));
                grid.innerHTML = sorted.map(p => generateCardHtml(p, false)).join('');
            }
            document.getElementById('squad-viewer-modal').style.display = 'flex';
        }

        function closeSquadViewer() {
            document.getElementById('squad-viewer-modal').style.display = 'none';
        }
 
        // ─── CARD HTML ───────────────────────────────────────────────────────────
        function generateCardHtml(p, clickable = true) {
            const rarity = (p.rarity || 'common').toLowerCase();
            const is1st   = rarity === '1st edition';
            const holoClass = p.isSuperHolo ? 'super-holo' : '';
            const artClass = p.id === 64 ? 'full-art' : '';
            const val = getCardValue(p);
            const clickAttr = clickable ? `onclick="showCardDetails('${p.instanceId}')"` : '';
            const isFav = p.isFavorite ? true : false;

            // 1st edition: use cyan for pos/rating badges, add 1ST badge
            const posBg  = is1st ? '#00c8ff' : '#3ecf8e';
            const ovrBg  = is1st ? '#001aff' : '#ffd700';
            const ovrColor = is1st ? '#fff' : 'black';
            const firstBadge = is1st
                ? `<div class="badge" style="top:auto;bottom:68px;left:10px;background:linear-gradient(135deg,#00f2ff,#0055ff);color:#fff;font-size:0.55rem;padding:2px 6px;letter-spacing:1px;">1ST ED</div>`
                : '';
            const favBadge = ''; // Fav shown in modal only (Fix 6)

            return `<div class="premium-card ${rarity} ${holoClass} ${artClass}" ${clickAttr}>
                        <div class="badge card-pos" style="background:${posBg};color:black">${p.position}</div>
                        <div class="badge card-ovr" style="background:${ovrBg};color:${ovrColor}">${p.rating}</div>
                        ${firstBadge}
                        ${p.serial ? `<div class="card-serial">LIMITED ${p.serial}/10</div>` : ''}
                        ${favBadge}
                        <img src="${p.image_url}" class="player-img">
                        <div class="nameplate">
                            <div class="card-name">${p.name}</div>
                            <div class="card-price" style="${p.isSuperHolo ? 'color:#00f2ff' : ''}">Value: ${val.toLocaleString()}</div>
                        </div>
                    </div>`;
        }
 
        // ─── CARD DETAILS MODAL ──────────────────────────────────────────────────
        let _modalCurrentId = null; // track which card is open in modal

        function showCardDetails(id) {
            const p = mySquad.find(player => player.instanceId == id);
            if (!p) return;
            _modalCurrentId = id;
            const val = getCardValue(p);
            const sellValue = Math.floor(val * SELL_RATE);
            document.getElementById('modal-card-render').innerHTML = generateCardHtml(p, false);
            document.getElementById('val-orig').innerText  = val.toLocaleString() + " 🪙";
            const actualSellValue = getSellValue(p);
            document.getElementById('val-sell').innerText  = actualSellValue > 0 ? actualSellValue.toLocaleString() + " 🪙" : 'NOT FOR SALE';
            document.getElementById('val-date').innerText  = p.collectedDate || "Historical";

            // Favourite button
            const favBtn = document.getElementById('modal-fav-btn');
            if (p.isFavorite) {
                favBtn.innerText = '⭐ FAVOURITED';
                favBtn.style.borderColor = '#ffd700';
                favBtn.style.color       = '#ffd700';
            } else {
                favBtn.innerText = '☆ FAVOURITE';
                favBtn.style.borderColor = '#333';
                favBtn.style.color       = '#888';
            }

            // --- Showcase Button ---
            const scBtn = document.getElementById('modal-showcase-btn');
            if (p.isShowcase) {
                scBtn.innerText = '🏆 CURRENT SHOWCASE';
                scBtn.style.borderColor = '#3ecf8e';
                scBtn.style.color       = '#3ecf8e';
                scBtn.style.background  = 'rgba(62, 207, 142, 0.1)';
            } else {
                scBtn.innerText = '🏆 SET AS SHOWCASE';
                scBtn.style.borderColor = '#333';
                scBtn.style.color       = '#888';
                scBtn.style.background  = 'none';
            }

            // Sell button — blocked if favourited
            const sellBtn = document.getElementById('modal-sell-btn');
            const isExchangeCard = (p.rarity || '').toLowerCase() === 'exchange' || p.isExchange;
            if (isExchangeCard) {
                sellBtn.disabled = true;
                sellBtn.innerText = '⚡ EXCHANGE REWARD — CANNOT SELL';
                sellBtn.style.background = '#1a1a0a';
                sellBtn.onclick = null;
            } else if (p.isFavorite) {
                sellBtn.disabled = true;
                sellBtn.innerText = '⭐ UNFAVOURITE FIRST TO SELL';
                sellBtn.style.background = '#333';
                sellBtn.onclick = null;
                } else if (_lockedCardIds.has(p.instanceId)) {       // 🚀 NEW LOCK CHECK
                sellBtn.disabled = true;
                sellBtn.innerText = '🔒 LOCKED IN ACTIVE TRADE';
                sellBtn.style.background = '#333';
                sellBtn.onclick = null;
            } else {
                sellBtn.disabled = false;
                sellBtn.innerText = 'QUICK SELL';
                sellBtn.style.background = '#ef4444';
                sellBtn.onclick = () => { if (confirm("Sell " + p.name + "?")) { finalizeSale(id); } };
            }
            document.getElementById('modal-overlay').style.display = 'flex';
        }

        async function modalToggleFavorite() {
            if (!_modalCurrentId) return;
            await toggleFavorite(_modalCurrentId);
            // Re-open modal to reflect updated state
            showCardDetails(_modalCurrentId);
        }
 
        async function finalizeSale(id) {
            const index = mySquad.findIndex(p => p.instanceId == id);
            if (index > -1) {
                balance += Math.floor(getCardValue(mySquad[index]) * SELL_RATE);
                mySquad.splice(index, 1);
                closeModal(); updateUI(); renderSquad();
                await saveGame();
            }
        }

        async function modalToggleShowcase() {
    if (!_modalCurrentId) return;
    
    // 1. Set every card to false
    mySquad.forEach(c => c.isShowcase = false);
    
    // 2. Set only the current card to true
    const p = mySquad.find(c => c.instanceId === _modalCurrentId);
    if (p) p.isShowcase = true;

    // 3. Save and refresh
    renderSquad();
    await saveGame();
    showCardDetails(_modalCurrentId); // Refresh modal UI
    showToast(`🏆 ${p.name} is now your Showcase Card!`);
}
 
        function closeModal() { document.getElementById('modal-overlay').style.display = 'none'; }
 
        // ─── VIEW MANAGEMENT ─────────────────────────────────────────────────────
        function showView(id) {
            // Auto-keep: if a pulled card is pending and user navigates away, keep it
            if (id !== 'slots' && currentPull) {
                currentPull.instanceId    = currentPull.instanceId    || ('inst_' + Date.now());
                currentPull.collectedDate = currentPull.collectedDate || new Date().toLocaleDateString();
                mySquad.push(currentPull);
                renderSquad();
                showToast('✅ ' + currentPull.name + ' auto-kept — navigated away');
                currentPull = null;
                saveGame();
            }
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
            document.getElementById('view-' + id).classList.add('active');
            const navBtn = document.getElementById('nav-' + id);
            if (navBtn) navBtn.classList.add('active');
            if (id === 'rank')   loadLeaderboard();
            if (id === 'office')    renderOfficeView();
            if (id === 'exchanges') { loadExchangeState().then(renderExchanges); }
            if (id === 'trade')  switchTradeTab('board');
            if (id === 'arena')  arenaToLobby();
            if (id === 'slots')  { resetUI(); closeCatalog(); initDailyReward(); }
            if (id !== 'team')   exitMultiSelect();
        }
 
        async function keepPlayer() { mySquad.push(currentPull); currentPull = null; renderSquad(); resetUI(); await saveGame(); }
        async function sellPlayer() { balance += Math.floor(getCardValue(currentPull) * SELL_RATE); currentPull = null; resetUI(); await saveGame(); }
 
        function resetUI() {
            document.getElementById('choiceArea').style.display = 'none';
            document.getElementById('pack-reveal').style.display = 'none';
            document.getElementById('pack-visual').style.display = 'none';
            document.getElementById('packArea').style.display = 'block';
            document.getElementById('default-message').style.display = 'block';
            updateUI();
        }
 
        function updateUI() {
            document.querySelectorAll('.bal-text').forEach(el => el.innerText = balance.toLocaleString());
            document.querySelectorAll('.team-count-menu').forEach(el => el.innerText = mySquad.length);
            // Club value = sum of top 10 cards by market value (Fix 5)
            const top10Val = [...mySquad]
                .sort((a,b) => getCardValue(b) - getCardValue(a))
                .slice(0, 10)
                .reduce((sum, p) => sum + getCardValue(p), 0);
            document.getElementById('nav-club-value').innerText = top10Val.toLocaleString();
            document.getElementById('team-count').innerText = mySquad.length;
        }
 
        function renderSquad() {
            const grid = document.getElementById('teamGrid');
            const sortVal = document.getElementById('squad-sort').value;

            // Favourites filter
            let displayList = sortVal === 'fav-only'
                ? mySquad.filter(p => p.isFavorite)
                : [...mySquad];

            if (sortVal !== 'fav-only') {
                displayList.sort((a, b) => {
                    if      (sortVal === 'date-desc')   return b.instanceId.split('_')[1] - a.instanceId.split('_')[1];
                    else if (sortVal === 'date-asc')    return a.instanceId.split('_')[1] - b.instanceId.split('_')[1];
                    else if (sortVal === 'value-desc')  return getCardValue(b) - getCardValue(a);
                    else if (sortVal === 'value-asc')   return getCardValue(a) - getCardValue(b);
                    else if (sortVal === 'rating-desc') return b.rating - a.rating;
                });
            }

            if (displayList.length === 0 && sortVal === 'fav-only') {
                grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#444;padding:60px;font-size:0.85rem;letter-spacing:1px;">NO FAVOURITED CARDS YET — OPEN A CARD AND CLICK FAVOURITE IN THE DETAILS</div>';
                updateUI(); return;
            }

            grid.innerHTML = displayList.map(p => {
                const isSelected = multiSelectMode && multiSelectIds.has(p.instanceId);
                return `<div class="squad-card-wrap ${isSelected ? 'ms-selected' : ''}"
                             onclick="squadCardClick(event, '${p.instanceId}')">
                            ${generateCardHtml(p, !multiSelectMode)}
                        </div>`;
            }).join('');
            updateUI();
            updatePlaytimeLabel();
        }
 
        // ─── CATALOG ─────────────────────────────────────────────────────────────
        function openCatalog() {
            document.getElementById('slot-container').style.display = 'none';
            document.getElementById('catalog-toggle-btn').style.display = 'none';
            document.getElementById('catalog-container').style.display = 'block';
            loadCatalog('gold');
        }
 
        function closeCatalog() {
            document.getElementById('catalog-container').style.display = 'none';
            document.getElementById('slot-container').style.display = 'flex';
            document.getElementById('catalog-toggle-btn').style.display = 'block';
        }
 
        async function loadCatalog(tier) {
            showLoading();
            let query = _supabase.from('soccer_stars').select('*');
            if (tier === 'holo') query = query.gte('rating', 85);
            else query = query.ilike('rarity', tier);
            const { data, error } = await query;
            hideLoading();
            const grid = document.getElementById('catalog-grid');
            if (error) { grid.innerHTML = `<p style="color:red">Error: ${error.message}</p>`; return; }
            if (tier === 'holo') data.forEach(p => p.isSuperHolo = true);
            data.sort((a, b) => getCardValue(b) - getCardValue(a));
            grid.innerHTML = data.map(p => generateCardHtml(p, false)).join('');
        }
 
 

        // ─── TRADE CONFIRM DISPATCHER ────────────────────────────────────────────
        // 'board'    = I am Player2 and clicked OFFER CARD — finalise sending my offer
        // 'incoming' = I am Player1 (original poster) and confirming the swap
        let _tradeConfirmMode = 'board';

        function handleTradeConfirm() {
            if (_tradeConfirmMode === 'incoming') {
                const trade = tradeState.pendingAcceptTrade;
                if (trade) executeSwap(trade);
            } else {
                finaliseAccept();
            }
        }

        // ─── TRADE SYSTEM ────────────────────────────────────────────────────────
        let tradeState = {
            activeTab: 'board',
            postSelectedCard: null,
            wantRarity: 'any',
            wantMinRating: 70,
            pendingAcceptTrade: null,   // full trade row being accepted
            pendingAcceptMyCard: null,  // card I'm sending
        };
        let tradePollInterval = null;
 
        // ── helpers ──────────────────────────────────────────────────────────────
        function cardMatchesCriteria(card, wantRarity, wantMinRating, wantName) {
            const rarityOk = wantRarity === 'any'
                || (wantRarity === 'holo' && card.isSuperHolo)
                || (!card.isSuperHolo && (card.rarity || 'common').toLowerCase() === wantRarity);
            const ratingOk = card.rating >= wantMinRating;
            const nameOk   = !wantName || card.name.toLowerCase().includes(wantName.toLowerCase());
            return rarityOk && ratingOk && nameOk;
        }
 
        function getWantDescription(trade) {
            const parts = [];
            if (trade.want_rarity && trade.want_rarity !== 'any') {
                const labels = { common:'Bronze', silver:'Silver', gold:'Gold', limited:'Limited', holo:'Holo' };
                parts.push(labels[trade.want_rarity] || trade.want_rarity);
            }
            if (trade.want_min_rating && trade.want_min_rating > 70) parts.push(trade.want_min_rating + '+');
            if (trade.want_name) parts.push('"' + trade.want_name + '"');
            return parts.length ? parts.join(' · ') : 'Any Card';
        }
 
        // ── tab switcher ─────────────────────────────────────────────────────────
        function switchTradeTab(tab) {
            tradeState.activeTab = tab;
            document.querySelectorAll('.trade-tab').forEach((b, i) => {
                const tabs = ['board','mine','incoming','post'];
                b.classList.toggle('active', tabs[i] === tab);
            });
            document.querySelectorAll('.trade-tab-panel').forEach(p => p.classList.remove('active'));
            document.getElementById('trade-panel-' + tab).classList.add('active');
            if (tab === 'board')     loadTradeBoard();
            if (tab === 'mine')      loadMyTrades();
            if (tab === 'incoming')  loadIncomingTrades();
            if (tab === 'post')      renderPostOfferGrid();
        }
 
        // ── POST OFFER: card picker ───────────────────────────────────────────────
        function renderPostOfferGrid() {
            const grid = document.getElementById('post-pick-grid');
            if (mySquad.length === 0) {
                grid.innerHTML = '<p style="color:#555;font-size:0.8rem;">No cards in your squad yet.</p>';
                return;
            }
            grid.innerHTML = mySquad
                .sort((a,b) => getCardValue(b) - getCardValue(a))
                .map(p => `
                    <div class="pick-card-wrap ${tradeState.postSelectedCard?.instanceId === p.instanceId ? 'selected' : ''}"
                         onclick="selectPostCard('${p.instanceId}')">
                        ${generateCardHtml(p, false)}
                    </div>`).join('');
            updateWantSummary();
        }
 
        function selectPostCard(id) {
            tradeState.postSelectedCard = mySquad.find(p => p.instanceId === id) || null;
            renderPostOfferGrid();
        }
 
        function toggleWantRarity(btn) {
            document.querySelectorAll('.want-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            tradeState.wantRarity = btn.dataset.rarity;
            updateWantSummary();
        }
 
        function updateWantRatingLabel() {
            const v = document.getElementById('want-rating-min').value;
            tradeState.wantMinRating = parseInt(v);
            document.getElementById('want-rating-label').innerText = v + '+';
            updateWantSummary();
        }
 
        function updateWantSummary() {
            const rarity = tradeState.wantRarity;
            const rating = tradeState.wantMinRating;
            const name   = (document.getElementById('want-name-input')?.value || '').trim();
            const parts  = [];
            if (rarity !== 'any') {
                const labels = { common:'Bronze', silver:'Silver', gold:'Gold', limited:'Limited', holo:'Holo' };
                parts.push(labels[rarity] || rarity);
            }
            if (rating > 70) parts.push(rating + '+ rated');
            if (name) parts.push('"' + name + '"');
            document.getElementById('want-summary').innerText = parts.length
                ? 'Looking for: ' + parts.join(', ')
                : 'Accepting any card in return';
 
            const canSubmit = !!tradeState.postSelectedCard;
            const btn = document.getElementById('post-offer-submit-btn');
            btn.disabled = !canSubmit;
            btn.innerText = canSubmit
                ? 'POST TRADE OFFER'
                : 'SELECT A CARD TO CONTINUE';
        }
 
        // ── SUBMIT OFFER ─────────────────────────────────────────────────────────
        async function submitTradeOffer() {
            if (!tradeState.postSelectedCard) return;
            const card = tradeState.postSelectedCard;
            const wantName = (document.getElementById('want-name-input')?.value || '').trim();
 
            showLoading();
            const { error } = await _supabase.from('trades').insert({
                sender_id: currentUser.id,
                sender_username: currentUser.user_metadata?.username || currentUser.email.split('@')[0],
                offered_card: card,
                want_rarity: tradeState.wantRarity,
                want_min_rating: tradeState.wantMinRating,
                want_name: wantName || null,
                status: 'open'
            });
            hideLoading();
 
            if (error) { showToast('❌ Failed to post offer: ' + error.message, 4000); return; }
 
            showToast('✅ Trade offer posted!');
            updateLockedCards();
            // Reset post panel
            tradeState.postSelectedCard = null;
            document.getElementById('want-rating-min').value = 70;
            tradeState.wantMinRating = 70;
            document.getElementById('want-rating-label').innerText = '70+';
            document.getElementById('want-name-input').value = '';
            tradeState.wantRarity = 'any';
            document.querySelectorAll('.want-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.rarity === 'any'));
            updateWantSummary();
            switchTradeTab('mine');
        }
 
        // ── LOAD BOARD ────────────────────────────────────────────────────────────
        async function loadTradeBoard() {
            const list = document.getElementById('trade-board-list');
            list.innerHTML = '<div class="no-trades"><div class="nt-icon">⏳</div><p>LOADING...</p></div>';
            const { data, error } = await _supabase
                .from('trades')
                .select('*')
                .eq('status', 'open')
                .neq('sender_id', currentUser.id)
                .order('created_at', { ascending: false })
                .limit(50);
            if (error || !data?.length) {
                list.innerHTML = '<div class="no-trades"><div class="nt-icon">📋</div><p>NO OPEN OFFERS RIGHT NOW — CHECK BACK SOON</p></div>';
                return;
            }
            list.innerHTML = data.map(t => buildTradeRow(t, 'board')).join('');
        }
 
        async function loadMyTrades() {
            const list = document.getElementById('trade-mine-list');
            list.innerHTML = '<div class="no-trades"><div class="nt-icon">⏳</div><p>LOADING...</p></div>';
            
            // Fetch trades where I am the sender OR the person offering a card (receiver)
            const { data, error } = await _supabase.from('trades').select('*')
                .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`)
                .in('status', ['open','pending'])
                .order('created_at', { ascending: false });

            if (error || !data?.length) {
                list.innerHTML = '<div class="no-trades"><div class="nt-icon">📤</div><p>YOU HAVE NO ACTIVE OFFERS OR BIDS</p></div>';
                return;
            }
            list.innerHTML = data.map(t => buildTradeRow(t, 'mine')).join('');
        }
 
        async function loadIncomingTrades() {
            // Player1 posted the trade (sender_id = me).
            // Player2 picked a card and set status = 'pending'.
            // Player1 needs to see these here to do the final accept/decline.
            const list = document.getElementById('trade-incoming-list');
            list.innerHTML = '<div class="no-trades"><div class="nt-icon">⏳</div><p>LOADING...</p></div>';
            const { data, error } = await _supabase
                .from('trades')
                .select('*')
                .eq('sender_id', currentUser.id)
                .eq('status', 'pending')
                .order('created_at', { ascending: false });
            if (error || !data?.length) {
                list.innerHTML = '<div class="no-trades"><div class="nt-icon">📬</div><p>NO INCOMING OFFERS ON YOUR TRADES YET</p></div>';
                updateTradeBadge(0); return;
            }
            list.innerHTML = data.map(t => buildTradeRow(t, 'incoming')).join('');
            updateTradeBadge(data.length);
        }
 
        // ── ROW BUILDER ───────────────────────────────────────────────────────────
        function buildTradeRow(t, mode) {
            const card = t.offered_card;
            const wantDesc = getWantDescription(t);
            const ago = timeAgo(t.created_at);
            const miniCard = `<div class="trade-mini-card">${generateCardHtml(card, false)}</div>`;
            let actions = '';
 
            if (mode === 'board') {
                actions = `<div class="trade-actions">
                    <button class="trade-btn accept" onclick="initiateBoardAccept('${t.id}')">OFFER CARD</button>
                </div>`;
            } else if (mode === 'mine') {
                const isSender = t.sender_id === currentUser.id;
                const isReceiver = t.receiver_id === currentUser.id;

                if (isSender) {
                    // This is YOUR post
                    const statusColor = t.status === 'pending' ? '#ffd700' : '#555';
                    const statusText = t.status === 'pending' ? 'CHECK INCOMING TAB' : 'OPEN';
                    actions = `<div class="trade-actions">
                        <div style="font-size:0.65rem;color:${statusColor};font-weight:900;letter-spacing:1px;text-align:center;">${statusText}</div>
                        <button class="trade-btn cancel" onclick="cancelTrade('${t.id}')">CANCEL</button>
                    </div>`;
                    
                    return `
                        <div class="trade-card mine">
                            ${miniCard}
                            <div class="trade-arrow">⇄</div>
                            <div class="trade-want-info">
                                <div class="trade-want-title">YOUR POSTED OFFER</div>
                                <div class="trade-want-val">${wantDesc}</div>
                                <div class="trade-want-sub">Value: ${getCardValue(card).toLocaleString()} 🪙 · ${card.name}</div>
                            </div>
                            <div class="trade-poster">${ago}</div>
                            ${actions}
                        </div>`;
                } else if (isReceiver) {
                    // This is YOUR PROPOSAL to someone else
                    actions = `<div class="trade-actions">
                        <div style="font-size:0.65rem;color:#ffd700;font-weight:900;letter-spacing:1px;text-align:center;">PENDING REVIEW</div>
                        <button class="trade-btn cancel" onclick="retractBid('${t.id}')">RETRACT OFFER</button>
                    </div>`;
                    
                    return `
                        <div class="trade-card mine" style="border-color:#ffd70044;">
                            <div class="trade-mini-card">${generateCardHtml(t.receiver_card, false)}</div>
                            <div class="trade-arrow">⇄</div>
                            ${miniCard}
                            <div class="trade-want-info">
                                <div class="trade-want-title">YOUR PROPOSAL TO ${(t.sender_username || 'MANAGER').toUpperCase()}</div>
                                <div class="trade-want-val">Trading ${t.receiver_card.name} for ${card.name}</div>
                                <div class="trade-want-sub">${ago}</div>
                            </div>
                            ${actions}
                        </div>`;
                }
            } else if (mode === 'incoming') {
                // I am Player1 (sender). offered_card = my card. receiver_card = what Player2 offers me.
                const theirCard = t.receiver_card;
                const theirMini = theirCard ? `<div class="trade-mini-card">${generateCardHtml(theirCard, false)}</div>` : '';
                actions = `<div class="trade-actions">
                    <button class="trade-btn accept" onclick="confirmIncomingAccept('${t.id}')">ACCEPT</button>
                    <button class="trade-btn decline" onclick="declineTrade('${t.id}')">DECLINE</button>
                </div>`;
                return `
                    <div class="trade-card incoming">
                        ${theirMini}
                        <div class="trade-arrow">⇄</div>
                        ${miniCard}
                        <div class="trade-want-info">
                            <div class="trade-want-title">OFFER FROM ${(t.receiver_username || 'MANAGER').toUpperCase()}</div>
                            <div class="trade-want-val">${theirCard ? theirCard.name : '—'} → your ${card.name}</div>
                            <div class="trade-want-sub">Their card value: ${theirCard ? getCardValue(theirCard).toLocaleString() : '—'} 🪙 · ${ago}</div>
                        </div>
                        ${actions}
                    </div>`;
            }
 
            return `
                <div class="trade-card ${mode === 'mine' ? 'mine' : ''}">
                    ${miniCard}
                    <div class="trade-arrow">⇄</div>
                    <div class="trade-want-info">
                        <div class="trade-want-title">WANTS IN RETURN</div>
                        <div class="trade-want-val">${wantDesc}</div>
                        <div class="trade-want-sub">Value: ${getCardValue(card).toLocaleString()} 🪙 · ${card.name}</div>
                    </div>
                    <div class="trade-poster">${ago}<span>${t.sender_username}</span></div>
                    ${actions}
                </div>`;
        }
 
        // ── BOARD: choose which of MY cards to offer ──────────────────────────────
        async function initiateBoardAccept(tradeId) {
            const { data: trade } = await _supabase.from('trades').select('*').eq('id', tradeId).single();
            if (!trade || trade.status !== 'open') { showToast('⚠ This offer is no longer available.'); loadTradeBoard(); return; }
 
            // Filter my squad to cards that match the want criteria
            const eligible = mySquad.filter(c =>
                cardMatchesCriteria(c, trade.want_rarity, trade.want_min_rating, trade.want_name)
            );
 
            if (eligible.length === 0) {
                showToast("⚠ You don't have any cards that match what they're asking for.", 5000);
                return;
            }
 
            tradeState.pendingAcceptTrade = trade;
            tradeState.pendingAcceptMyCard = null;
 
            const grid = document.getElementById('trade-pick-grid');
            const sub  = document.getElementById('trade-pick-sub');
            sub.innerText = `They want: ${getWantDescription(trade)} · Select one of your eligible cards below`;
            grid.innerHTML = eligible.map(c => `
                <div class="pick-card-wrap" onclick="selectPickCard('${c.instanceId}', this)">
                    ${generateCardHtml(c, false)}
                </div>`).join('');
            document.getElementById('trade-pick-modal').style.display = 'flex';
        }
 
        function selectPickCard(instanceId, el) {
            document.querySelectorAll('#trade-pick-grid .pick-card-wrap').forEach(w => w.classList.remove('selected'));
            el.classList.add('selected');
            tradeState.pendingAcceptMyCard = mySquad.find(c => c.instanceId === instanceId);
            // After picking, show confirm modal
            setTimeout(() => showTradeConfirmModal(), 200);
        }
 
        function closePickModal() {
            document.getElementById('trade-pick-modal').style.display = 'none';
            tradeState.pendingAcceptTrade = null;
            tradeState.pendingAcceptMyCard = null;
        }
 
        // ── CONFIRM MODAL ─────────────────────────────────────────────────────────
        function showTradeConfirmModal() {
            const trade  = tradeState.pendingAcceptTrade;
            const myCard = tradeState.pendingAcceptMyCard;
            if (!trade || !myCard) return;
            _tradeConfirmMode = 'board'; // Player2 path — calls finaliseAccept
            document.getElementById('tam-receive-card').innerHTML = generateCardHtml(trade.offered_card, false);
            document.getElementById('tam-send-card').innerHTML    = generateCardHtml(myCard, false);
            document.getElementById('trade-pick-modal').style.display = 'none';
            document.getElementById('trade-accept-modal').style.display = 'flex';
        }
 
        function closeTAModal() {
            document.getElementById('trade-accept-modal').style.display = 'none';
        }
 
        // ── FINALISE BOARD ACCEPT (send pending request to the poster) ────────────
        async function finaliseAccept() {
            const trade  = tradeState.pendingAcceptTrade;
            const myCard = tradeState.pendingAcceptMyCard;
            if (!trade || !myCard) return;
            closeTAModal();
            showLoading();
 
            // Mark trade as pending with receiver info and their card
            const { error } = await _supabase.from('trades').update({
                receiver_id: currentUser.id,
                receiver_username: currentUser.user_metadata?.username || currentUser.email.split('@')[0],
                receiver_card: myCard,
                status: 'pending',
                updated_at: new Date().toISOString()
            }).eq('id', trade.id).eq('status', 'open');
 
            hideLoading();
            if (error) { showToast('❌ Trade request failed: ' + error.message); return; }
            showToast('📨 Trade request sent! Waiting for them to confirm.');
            tradeState.pendingAcceptTrade = null;
            tradeState.pendingAcceptMyCard = null;
            _myPendingTradeIds.push(trade.id);
            updateLockedCards();
            loadTradeBoard();
            checkTradeBadge();
        }
 
        // ── INCOMING: Player1 (original poster / sender) doing final confirm ────────
        async function confirmIncomingAccept(tradeId) {
            const { data: trade } = await _supabase.from('trades').select('*').eq('id', tradeId).single();
            if (!trade || trade.status !== 'pending') { showToast('⚠ Trade no longer available.'); loadIncomingTrades(); return; }

            // Verify I (Player1/sender) still own the card I originally listed
            const myOffered = mySquad.find(c => c.instanceId === trade.offered_card.instanceId);
            if (!myOffered) { showToast('⚠ You no longer own the card you listed. Trade cannot proceed.'); return; }

            tradeState.pendingAcceptTrade = trade;
            _tradeConfirmMode = 'incoming'; // tell handleTradeConfirm to call executeSwap
            // Player1 perspective: YOU RECEIVE = receiver_card (Player2's), YOU SEND = offered_card (mine)
            document.getElementById('tam-receive-card').innerHTML = generateCardHtml(trade.receiver_card, false);
            document.getElementById('tam-send-card').innerHTML    = generateCardHtml(trade.offered_card, false);
            document.getElementById('trade-accept-modal').style.display = 'flex';
        }
 
        // ── EXECUTE THE ACTUAL CARD SWAP ──────────────────────────────────────────
        // ── EXECUTE THE ACTUAL CARD SWAP (Secure Server-Side RPC) ───────────────────────
        async function executeSwap(trade) {
            closeTAModal();
            showLoading();

            // 1. Tell Supabase to run our secure backend function
            const { data, error } = await _supabase.rpc('execute_secure_trade', {
                trade_uuid: trade.id
            });

            if (error || data !== 'SUCCESS') {
                hideLoading();
                showToast('❌ Trade failed: ' + (error?.message || data));
                return;
            }

            // 2. The database successfully swapped the cards! Now we just reload our save to see our new card.
            await loadCloudSave();
            await updateLockedCards();

            hideLoading();
            renderSquad();
            updateUI();
            showToast('🎉 Trade complete! Both accounts securely updated.');
            tradeState.pendingAcceptTrade = null;
            loadIncomingTrades();
            checkTradeBadge();
        }
 
        // ── DECLINE / CANCEL ──────────────────────────────────────────────────────
        async function declineTrade(tradeId) {
            if (!confirm('Decline this trade request?')) return;
            await _supabase.from('trades').update({ status: 'open', receiver_id: null, receiver_username: null, receiver_card: null, updated_at: new Date().toISOString() }).eq('id', tradeId);
            showToast('Trade declined — offer returned to board.');
            loadIncomingTrades();
        }
 
        async function cancelTrade(tradeId) {
            if (!confirm('Cancel this trade offer? It will be removed from the board.')) return;
            await _supabase.from('trades').update({ status: 'cancelled' }).eq('id', tradeId);
            showToast('Trade offer cancelled.');
            loadMyTrades();
        }
        // ── RETRACT AN OFFER (For Player 2/Receiver) ──────────────────────────────
        async function retractBid(tradeId) {
            if (!confirm('Retract your offered card and unlock it?')) return;
            
            showLoading();
            
            // 1. Update the trade: Set status back to 'open' and wipe your offer info
            const { error } = await _supabase.from('trades')
                .update({ 
                    status: 'open', 
                    receiver_id: null, 
                    receiver_username: null, 
                    receiver_card: null, 
                    updated_at: new Date().toISOString() 
                })
                .eq('id', tradeId);

            if (error) {
                showToast('❌ Failed to retract: ' + error.message);
                hideLoading();
                return;
            }

            // 2. Refresh the local state
            await updateLockedCards(); // This unlocks the card in your squad UI
            hideLoading();
            showToast('Offer retracted. Your card is unlocked!');
            
            // 3. Refresh the "My Offers" list so the card disappears/updates
            loadMyTrades(); 
        }
 
        // ── BADGE POLLING ─────────────────────────────────────────────────────────
        async function checkTradeBadge() {
            if (!currentUser) return;

            // 1. Existing Badge Logic
            const { count } = await _supabase.from('trades')
                .select('id', { count: 'exact', head: true })
                .eq('sender_id', currentUser.id)
                .eq('status', 'pending');
            updateTradeBadge(count || 0);

            // 2. NEW: Accepted Trade Detector
            // We check if the database says your save file is newer than what you have open
            const { data: saveCheck } = await _supabase.from('user_saves')
                .select('updated_at')
                .eq('user_id', currentUser.id)
                .single();

            if (saveCheck && _lastSaveCheckDate && saveCheck.updated_at > _lastSaveCheckDate) {
                // Someone (the trade server) updated your save!
                _lastSaveCheckDate = saveCheck.updated_at;
                await loadCloudSave();    // Refresh your squad
                await updateLockedCards(); // Unlock the new cards
                showToast('🎉 TRADE ACCEPTED! Your new cards have been added to your squad.', 6000);
            }
            // 3. NEW: Declined Trade Detector (For when you are the bidder)
            if (_myPendingTradeIds.length > 0) {
                const { data: myBids } = await _supabase.from('trades')
                    .select('id, status, receiver_id')
                    .in('id', _myPendingTradeIds);

                if (myBids) {
                    let stillPending = [];
                    myBids.forEach(t => {
                        // If status went back to 'open' and you're no longer the receiver, it was declined
                        if (t.status === 'open' && t.receiver_id !== currentUser.id) {
                            showToast('❌ A trade proposal was declined. Your card has been unlocked.', 6000);
                            updateLockedCards(); 
                        } else if (t.status === 'pending') {
                            stillPending.push(t.id);
                        }
                    });
                    _myPendingTradeIds = stillPending;
                }
            }
        }
 
        function updateTradeBadge(n) {
            const badge = document.getElementById('trade-badge');
            const tab   = document.getElementById('incoming-count-tab');
            badge.style.display = n > 0 ? 'flex' : 'none';
            if (tab) tab.innerText = n > 0 ? `(${n})` : '';
        }
 
        function startTradePoll() {
            checkTradeBadge();
            tradePollInterval = setInterval(checkTradeBadge, 10000); // poll every 10s
        }
 
        function stopTradePoll() {
            if (tradePollInterval) { clearInterval(tradePollInterval); tradePollInterval = null; }
        }
 
        function timeAgo(iso) {
            const diff = Date.now() - new Date(iso).getTime();
            const m = Math.floor(diff / 60000);
            if (m < 1)  return 'just now';
            if (m < 60) return m + 'm ago';
            const h = Math.floor(m / 60);
            if (h < 24) return h + 'h ago';
            return Math.floor(h / 24) + 'd ago';
        }
 


        // ══════════════════════════════════════════════════════════════════════
        // ─── EXCHANGES ────────────────────────────────────────────────────────
        //
        // HOW TO ADD A NEW EXCHANGE:
        //   1. Add your reward card to soccer_stars in Supabase:
        //      - rarity = 'exchange'
        //      - in_packs = false
        //      - base_price = whatever you want (no quick sell, just market value)
        //      Note the card's ID.
        //
        //   2. Copy the object below and add it to the EXCHANGES array.
        //      Change: id, name, description, playerId (ID of card to collect),
        //      playerName, quantity (how many needed), rewardId (ID of reward card).
        //
        //   3. To retire: set active: false — it will show as greyed out.
        //      To remove completely: delete the object.
        //
        // ══════════════════════════════════════════════════════════════════════
        const EXCHANGES = [
            // ── ADD / EDIT EXCHANGES HERE ────────────────────────────────────
            {
                id:          'fermin_exchange_1',   // unique string — NEVER change once live
                active:      true,                  // false = retired/hidden
                name:        'The Fermin Special',
                description: 'Exchange 10 Fermín López cards for an exclusive upgraded version',
                playerId:    25,                    // soccer_stars.id of the card to collect
                playerName:  'Fermín López',
                quantity:    10,                     // how many of playerId are needed
                rewardId:    95,                  // soccer_stars.id of the exchange reward card !!Set to the actual DB id once you create it
                                                    // 
                rewardName:  'Fermín López (Exchange)',
            },
            {
                id:          'dybala_exchange_1',   // unique string — NEVER change once live
                active:      true,                  // false = retired/hidden
                name:        'Dybala for Degens',
                description: 'Exchange 15 Paulo Dybala cards for an exclusive upgraded version',
                playerId:    50,                    // soccer_stars.id of the card to collect
                playerName:  'Paulo Dybala',
                quantity:    15,                     // how many of playerId are needed
                rewardId:    99,                  // soccer_stars.id of the exchange reward card !!Set to the actual DB id once you create it
                                                    // 
                rewardName:  'Paulo Dybala (Exchange)',
            },

            {
                id:          'mbappe_exchange_1',   // unique string — NEVER change once live
                active:      true,                  // false = retired/hidden
                name:        'Gear Up',
                description: 'Exchange 30 Mbappe cards for an exclusive upgraded version',
                playerId:    8,                    // soccer_stars.id of the card to collect
                playerName:  'Kylian Mbappe',
                quantity:    30,                     // how many of playerId are needed
                rewardId:    100,                  // soccer_stars.id of the exchange reward card !!Set to the actual DB id once you create it
                                                    // 
                rewardName:  'Mbappe (Exchange)',
            },

            {
                id:          'son_exchange_1',   // unique string — NEVER change once live
                active:      true,                  // false = retired/hidden
                name:        'Sonny Init',
                description: 'Exchange 20 Son cards for an exclusive upgraded version',
                playerId:    41,                    // soccer_stars.id of the card to collect
                playerName:  'Son',
                quantity:    20,                     // how many of playerId are needed
                rewardId:    101,                  // soccer_stars.id of the exchange reward card !!Set to the actual DB id once you create it
                                                    // 
                rewardName:  'Son (Exchange)',
            },
            // ── END OF EXCHANGES — add new ones above this line ──────────────
        ];


        let _excFilter = 'all'; // 'all' | 'active' | 'completed'

        function setExcFilter(f) {
            _excFilter = f;
            document.querySelectorAll('.exc-filter-tab').forEach(b => b.classList.remove('active'));
            const tab = document.getElementById('exc-tab-' + f);
            if (tab) tab.classList.add('active');
            renderExchanges();
        }

        // ─── Exchange state ───────────────────────────────────────────────────
        let completedExchanges = []; // loaded from user_saves.completed_exchanges

        async function loadExchangeState() {
            if (!currentUser) return;
            const { data } = await _supabase
                .from('user_saves')
                .select('completed_exchanges')
                .eq('user_id', currentUser.id)
                .single();
            completedExchanges = data?.completed_exchanges || [];
        }

        async function saveExchangeState() {
            if (!currentUser) return;
            await _supabase.from('user_saves').update({
                completed_exchanges: completedExchanges,
                updated_at: new Date().toISOString()
            }).eq('user_id', currentUser.id);
        }

        // ─── Render exchanges view ────────────────────────────────────────────
        async function renderExchanges() {
            const list = document.getElementById('exc-list');
            let visibleExchanges = EXCHANGES.filter(e => e.active !== false);

            if (visibleExchanges.length === 0) {
                list.innerHTML = '<div style="color:#555;text-align:center;padding:60px;letter-spacing:1px;font-size:0.85rem;grid-column:1/-1;">NO ACTIVE EXCHANGES RIGHT NOW — CHECK BACK SOON</div>';
                return;
            }

            // Apply filter
            if (_excFilter === 'completed') {
                visibleExchanges = visibleExchanges.filter(e => completedExchanges.includes(e.id));
            } else if (_excFilter === 'active') {
                visibleExchanges = visibleExchanges.filter(e => !completedExchanges.includes(e.id));
            }

            if (visibleExchanges.length === 0) {
                const msg = _excFilter === 'completed'
                    ? 'NO COMPLETED EXCHANGES YET — GET TRADING!'
                    : 'ALL EXCHANGES COMPLETED — CHECK BACK FOR NEW ONES!';
                list.innerHTML = `<div style="color:#555;text-align:center;padding:60px;letter-spacing:1px;font-size:0.85rem;grid-column:1/-1;">${msg}</div>`;
                return;
            }

            const activeExchanges = visibleExchanges;

            // Fetch cost card data + reward card data from DB for display
            const allIds = [...new Set([
                ...activeExchanges.map(e => e.playerId),
                ...activeExchanges.filter(e => e.rewardId).map(e => e.rewardId)
            ])];

            let cardDb = {};
            if (allIds.length > 0) {
                const { data: cards } = await _supabase
                    .from('soccer_stars')
                    .select('*')
                    .in('id', allIds);
                (cards || []).forEach(c => { cardDb[c.id] = c; });
            }

            // Apply sort
            const sortVal = document.getElementById('exc-sort')?.value || 'reward-value-desc';
            if (sortVal === 'reward-value-desc') {
                activeExchanges.sort((a,b) => (cardDb[b.rewardId]?.base_price||0) - (cardDb[a.rewardId]?.base_price||0));
            } else if (sortVal === 'reward-value-asc') {
                activeExchanges.sort((a,b) => (cardDb[a.rewardId]?.base_price||0) - (cardDb[b.rewardId]?.base_price||0));
            }
            // 'date-added' = natural EXCHANGES array order (already preserved)

            list.innerHTML = activeExchanges.map(exc => {
                const isDone    = completedExchanges.includes(exc.id);
                const costCard  = cardDb[exc.playerId];
                const rewCard   = exc.rewardId ? cardDb[exc.rewardId] : null;

                // Count how many of the cost card the player currently owns
                const owned = mySquad.filter(c => c.id === exc.playerId).length;
                const canDo = !isDone && owned >= exc.quantity;
                const pct   = Math.min(100, Math.floor((owned / exc.quantity) * 100));

                // Build a tiny stacked display of cost cards
                const costCardHtml = costCard
                    ? Array.from({ length: Math.min(3, exc.quantity) })
                        .map((_, i) => `<div class="exc-cost-card" style="margin-top:${i===0?'0':'-42px'}">${generateCardHtml(costCard, false)}</div>`)
                        .join('')
                    : `<div style="color:#555;font-size:0.8rem;padding:20px;">${exc.playerName}</div>`;

                const rewardCardHtml = rewCard
                    ? `<div class="exc-reward-wrap">${generateCardHtml({ ...rewCard, rarity: 'exchange' }, false)}</div>`
                    : `<div style="color:#f97316;font-size:0.85rem;font-weight:900;padding:20px;border:1px solid #f9731644;border-radius:12px;">${exc.rewardName}<br><span style="font-size:0.65rem;color:#555;">EXCLUSIVE</span></div>`;

                const statusLabel = isDone ? 'COMPLETED' : (canDo ? 'AVAILABLE' : `${owned}/${exc.quantity} OWNED`);
                const statusClass = isDone ? 'done' : (canDo ? 'available' : 'locked');
                const btnClass    = isDone ? 'done' : (canDo ? 'go' : 'locked');
                const btnLabel    = isDone ? '✓ EXCHANGE DONE' : (canDo ? '⚡ EXCHANGE NOW' : `NEED ${exc.quantity - owned} MORE ${exc.playerName.toUpperCase()}`);
                const itemClass   = isDone ? 'completed' : (canDo ? 'available' : '');

                return `
                    <div class="exc-item ${itemClass}">
                        <div class="exc-item-header">
                            <div>
                                <div class="exc-item-name">${exc.name}</div>
                                <div class="exc-item-desc">${exc.description}</div>
                            </div>
                            <div class="exc-status-badge ${statusClass}">${statusLabel}</div>
                        </div>

                        <div class="exc-cards-row">
                            <div class="exc-cost-col">
                                <div class="exc-side-label">You give · ${exc.quantity}×</div>
                                <div class="exc-cost-stack">${costCardHtml}</div>
                                <div class="exc-cost-count">× ${exc.quantity}</div>
                            </div>
                            <div class="exc-arrow">→</div>
                            <div class="exc-reward-col">
                                <div class="exc-side-label">You receive</div>
                                ${rewardCardHtml}
                            </div>
                        </div>

                        <div class="exc-progress-wrap">
                            <div class="exc-progress-bar" style="width:${isDone?100:pct}%"></div>
                        </div>
                        <div class="exc-progress-label">${isDone ? 'Exchange completed' : owned + ' / ' + exc.quantity + ' cards owned'}</div>

                        <button class="exc-btn ${btnClass}"
                            onclick="${canDo ? `doExchange('${exc.id}')` : ''}"
                            ${isDone || !canDo ? 'disabled' : ''}>${btnLabel}</button>
                    </div>`;
            }).join('');
        }

        // ─── Execute exchange ─────────────────────────────────────────────────
// Add a lock to prevent spam-clicking
let _isExchanging = false; 

// ─── Execute exchange ─────────────────────────────────────────────────
async function doExchange(exchangeId) {
    if (_isExchanging) return; // Block double-clicks

    const exc = EXCHANGES.find(e => e.id === exchangeId);
    if (!exc) return;
    
    // 1. Check the completed list
    if (completedExchanges.includes(exchangeId)) { 
        showToast('⚠ Already completed.'); 
        return; 
    }

    // 2. BULLETPROOF CHECK: Do they already own the reward?
    if (exc.rewardId && mySquad.some(c => c.id === exc.rewardId)) {
        showToast('⚠ You already own this exclusive reward card!');
        
        // Auto-fix the database if their completed list got wiped somehow
        if (!completedExchanges.includes(exchangeId)) {
            completedExchanges.push(exchangeId);
            saveGame(); 
            renderExchanges();
        }
        return;
    }

    // Verify player has enough copies
    const copies = mySquad.filter(c => c.id === exc.playerId);
    if (copies.length < exc.quantity) { showToast('⚠ Not enough cards.'); return; }

    if (!confirm(`Exchange ${exc.quantity}× ${exc.playerName} for ${exc.rewardName}? This CANNOT be undone.`)) return;

    _isExchanging = true; // Lock the function
    showLoading();

    try {
        // Remove qty copies from squad (pick lowest-value ones first to protect good ones)
        const sorted = copies.sort((a, b) => getCardValue(a) - getCardValue(b));
        const toRemove = sorted.slice(0, exc.quantity).map(c => c.instanceId);
        mySquad = mySquad.filter(c => !toRemove.includes(c.instanceId));

        // Fetch the reward card from DB if rewardId is set
        let rewardCard = null;
        if (exc.rewardId) {
            const { data } = await _supabase
                .from('soccer_stars')
                .select('*')
                .eq('id', exc.rewardId)
                .single();
            if (data) {
                rewardCard = {
                    ...data,
                    rarity: 'exchange',
                    instanceId: 'inst_' + Date.now(),
                    collectedDate: new Date().toLocaleDateString(),
                    isExchange: true
                };
                mySquad.push(rewardCard);
            }
        }

        // Mark exchange as done
        completedExchanges.push(exchangeId);

        renderSquad();
        updateUI();
        await saveGame(); // saveGame automatically handles completedExchanges now

        showToast('⚡ Exchange complete! ' + exc.rewardName + ' added to your squad.');
        renderExchanges(); // Refresh the exchange list
    } catch (error) {
        showToast('❌ Error processing exchange.');
        console.error(error);
    }

    _isExchanging = false; // Unlock the function
    hideLoading();
}


        // ─── PLAYTIME TRACKING ────────────────────────────────────────────────────
        let _sessionStart = null;
        let _totalHoursPlayed = 0; // loaded from DB
        let _playtimeInterval = null;

        function startPlaytimeTracking() {
            _sessionStart = Date.now();
            // Tick every minute to update the footer label
            _playtimeInterval = setInterval(updatePlaytimeLabel, 60000);
            updatePlaytimeLabel();
        }

        function updatePlaytimeLabel() {
            const el = document.getElementById('squad-playtime-label');
            if (!el) return;
            const sessionMs = _sessionStart ? Date.now() - _sessionStart : 0;
            const totalMs   = (_totalHoursPlayed * 3600000) + sessionMs;
            const totalMins = Math.floor(totalMs / 60000);
            const h = Math.floor(totalMins / 60);
            const m = totalMins % 60;
            el.innerText = h > 0 ? `${h}h ${m}m` : `${m}m`;
        }

        async function flushPlaytime() {
            if (!currentUser || !_sessionStart) return;
            const sessionHours = (Date.now() - _sessionStart) / 3600000;
            if (sessionHours < 0.001) return; // less than 3.6 seconds — skip
            _totalHoursPlayed += sessionHours;
            _sessionStart = Date.now(); // reset session start so we don't double-count
            await _supabase.from('user_saves').update({
                hours_played: _totalHoursPlayed,
                updated_at: new Date().toISOString()
            }).eq('user_id', currentUser.id);
        }


        // ─── DAILY COLLECT ────────────────────────────────────────────────────────
        const DAILY_REWARD_COINS = 2000;
        // Central Time = UTC-6 standard, UTC-5 daylight. We determine midnight CT.

        function getMidnightCT() {
            // Get current time in Central Time
            const now = new Date();
            const ctOffset = -6; // Standard; JS can't reliably detect DST automatically
            // Use Intl to figure out the CT date string
            const ctStr = now.toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
            // Build a Date representing midnight CT = the start of today in CT as UTC
            const ctParts = ctStr.split('/');
            const m = ctParts[0].padStart(2,'0'), d = ctParts[1].padStart(2,'0'), y = ctParts[2];
            // midnight CT in ISO = yyyy-mm-dd + offset
            const ctDateStr = `${y}-${m}-${d}T00:00:00`;
            // Figure out CT offset from UTC at this moment
            const ctNow    = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
            const diffMs   = now - ctNow; // diff between UTC and CT
            return new Date(new Date(ctDateStr).getTime() + diffMs);
        }

        function getTodayKeyCT() {
            return new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
        }

        async function initDailyReward() {
            const banner = document.getElementById('daily-collect-banner');
            const sub    = document.getElementById('daily-collect-sub');
            const btn    = document.getElementById('daily-collect-btn');
            if (!banner) return;

            // Fetch last_daily_collect from DB
            const { data } = await _supabase
                .from('user_saves')
                .select('last_daily_collect')
                .eq('user_id', currentUser.id)
                .single();

            const lastCollect = data?.last_daily_collect || null;
            const todayCT     = getTodayKeyCT();
            const alreadyDone = lastCollect === todayCT;

            banner.style.display = 'flex';

            if (alreadyDone) {
                banner.className = 'daily-collect-banner done';
                sub.innerText    = 'Already collected today · Resets at midnight CT';
                btn.className    = 'daily-collect-btn done';
                btn.innerText    = '✓ COLLECTED';
                btn.disabled     = true;
            } else {
                banner.className = 'daily-collect-banner ready';
                sub.innerText    = `+${DAILY_REWARD_COINS.toLocaleString()} 🪙 free coins — resets midnight CT`;
                btn.className    = 'daily-collect-btn ready';
                btn.innerText    = `COLLECT +${DAILY_REWARD_COINS.toLocaleString()} 🪙`;
                btn.disabled     = false;
            }
        }

        async function claimDailyReward() {
            const btn  = document.getElementById('daily-collect-btn');
            const sub  = document.getElementById('daily-collect-sub');
            const banner = document.getElementById('daily-collect-banner');
            if (!btn || btn.disabled) return;

            // Double-check server-side that it hasn't been claimed
            const { data } = await _supabase
                .from('user_saves')
                .select('last_daily_collect')
                .eq('user_id', currentUser.id)
                .single();

            const todayCT = getTodayKeyCT();
            if (data?.last_daily_collect === todayCT) {
                showToast('⚠ Already collected today!');
                initDailyReward();
                return;
            }

            // Save the collect date FIRST (prevent double-collect race)
            const { error } = await _supabase.from('user_saves').update({
                last_daily_collect: todayCT,
                updated_at: new Date().toISOString()
            }).eq('user_id', currentUser.id);

            if (error) { showToast('❌ Error claiming reward.'); return; }

            // Credit coins
            balance += DAILY_REWARD_COINS;
            updateUI();
            await saveGame();

            // Update UI
            banner.className = 'daily-collect-banner done';
            sub.innerText    = 'Already collected today · Resets at midnight CT';
            btn.className    = 'daily-collect-btn done';
            btn.innerText    = '✓ COLLECTED';
            btn.disabled     = true;

            showToast(`🎁 Daily reward claimed! +${DAILY_REWARD_COINS.toLocaleString()} 🪙`);
        }


        function handleSquadNavClick(e) {
            e.stopPropagation();
            const menu = document.getElementById('nav-squad-menu');
            if (menu.classList.contains('open')) { closeNavDropdown(); }
            else { openNavDropdown(); }
        }
        function openNavDropdown()  { document.getElementById('nav-squad-menu').classList.add('open'); }
        function closeNavDropdown() { document.getElementById('nav-squad-menu').classList.remove('open'); }
        // ─── MULTI-SELECT SELL (Fix 1) ────────────────────────────────────────────
        let multiSelectMode = false;
        let multiSelectIds  = new Set();

        function toggleMultiSelect() {
            multiSelectMode = !multiSelectMode;
            const btn = document.getElementById('ms-toggle-btn');
            btn.classList.toggle('active', multiSelectMode);
            btn.innerText = multiSelectMode ? '✕ CANCEL SELECTION' : '☑ SELECT MULTIPLE';
            if (!multiSelectMode) {
                multiSelectIds.clear();
                updateMultiSelectUI();
            }
            renderSquad();
        }

        function exitMultiSelect() {
            if (!multiSelectMode) return;
            multiSelectMode = false;
            multiSelectIds.clear();
            document.getElementById('ms-toggle-btn').classList.remove('active');
            document.getElementById('ms-toggle-btn').innerText = '☑ SELECT MULTIPLE';
            updateMultiSelectUI();
        }

        function squadCardClick(event, instanceId) {
            if (!multiSelectMode) return; // normal click handled by generateCardHtml onclick
            if (multiSelectIds.has(instanceId)) {
                multiSelectIds.delete(instanceId);
            } else {
                multiSelectIds.add(instanceId);
            }
            updateMultiSelectUI();
            renderSquad();
        }

        function updateMultiSelectUI() {
            const countEl  = document.getElementById('ms-count-label');
            const sellBtn  = document.getElementById('ms-sell-btn');
            const n        = multiSelectIds.size;
            const sellable = [...multiSelectIds].filter(id => {
                const p = mySquad.find(c => c.instanceId === id);
                const isExc = p && ((p.rarity||'').toLowerCase()==='exchange' || p.isExchange);
                return p && !p.isFavorite && !isExc && !_lockedCardIds.has(id);
            });
            const totalVal = sellable.reduce((sum, id) => {
                const p = mySquad.find(c => c.instanceId === id);
                return sum + (p ? Math.floor(getCardValue(p) * SELL_RATE) : 0);
            }, 0);

            countEl.style.display  = n > 0 ? 'block' : 'none';
            sellBtn.style.display  = n > 0 ? 'block' : 'none';
            countEl.innerText = `${n} SELECTED${sellable.length < n ? ' (' + (n - sellable.length) + ' favorited, protected)' : ''}`;
            sellBtn.innerText = `SELL ${sellable.length} CARD${sellable.length !== 1 ? 'S' : ''} (+${totalVal.toLocaleString()} 🪙)`;
        }

        async function sellSelected() {
            const sellable = [...multiSelectIds].filter(id => {
                const p = mySquad.find(c => c.instanceId === id);
                const isExc = p && ((p.rarity||'').toLowerCase()==='exchange' || p.isExchange);
                return p && !p.isFavorite && !isExc;
            });
            if (sellable.length === 0) { showToast('⚠ All selected cards are favorited.'); return; }
            const totalVal = sellable.reduce((sum, id) => {
                const p = mySquad.find(c => c.instanceId === id);
                return sum + (p ? Math.floor(getCardValue(p) * SELL_RATE) : 0);
            }, 0);
            if (!confirm(`Sell ${sellable.length} card${sellable.length !== 1 ? 's' : ''} for ${totalVal.toLocaleString()} 🪙?`)) return;
            balance += totalVal;
            mySquad = mySquad.filter(p => !sellable.includes(p.instanceId));
            multiSelectIds.clear();
            exitMultiSelect();
            updateUI(); renderSquad();
            await saveGame();
            showToast(`🪙 Sold ${sellable.length} card${sellable.length !== 1 ? 's' : ''} for ${totalVal.toLocaleString()} 🪙`);
        }

        // ─── FAVORITE SYSTEM (Fix 5) ──────────────────────────────────────────────
        async function toggleFavorite(instanceId) {
            const p = mySquad.find(c => c.instanceId === instanceId);
            if (!p) return;
            p.isFavorite = !p.isFavorite;
            renderSquad();
            await saveGame();
            showToast(p.isFavorite ? `⭐ ${p.name} favorited — protected from sale` : `${p.name} unfavorited`);
        }

        // ─── BOOT ────────────────────────────────────────────────────────────────
        // Close dropdown when clicking outside
        document.addEventListener('click', function(e) {
            const dd = document.getElementById('squad-nav-dropdown');
            if (dd && !dd.contains(e.target)) closeNavDropdown();
        });

        checkExistingSession();

        let onlineUsers = {}; // Stores { presenceId: { username } }

let _roomChannel = null; // global so we can broadcast from openPack

function setupPresence() {
    if (!currentUser) return;

    // Create the channel with both presence + broadcast support
    _roomChannel = _supabase.channel('ranking_room', {
        config: {
            presence: { key: currentUser.id },
            broadcast: { self: false } // don't echo back to sender
        }
    });

    // Listen for presence sync (online users list)
    _roomChannel
        .on('presence', { event: 'sync' }, () => {
            const newState = _roomChannel.presenceState();
            renderOnlineList(newState);
        })
        // Listen for limited pull broadcasts from OTHER players
        .on('broadcast', { event: 'limited_pull' }, ({ payload }) => {
            // Only show if it's not us who packed it
            if (payload.packerId !== currentUser.id) {
                showLimitedPullAlert(payload);
            }
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                const myUsername = currentUser.user_metadata?.username || "Manager";
                await _roomChannel.track({
                    username: myUsername,
                    onlineAt: new Date().toISOString(),
                });
            }
        });
}

// Show the 5-second full-screen alert to everyone else
let _lpaTimer = null;
function showLimitedPullAlert(payload) {
    const overlay  = document.getElementById('limited-pull-overlay');
    const headline = document.getElementById('lpa-headline');
    const sub      = document.getElementById('lpa-sub');
    const cardWrap = document.getElementById('lpa-card-wrap');
    const countdown = document.getElementById('lpa-countdown');
    const bar      = document.getElementById('lpa-progress-bar');

    headline.innerText = (payload.username || 'A MANAGER').toUpperCase() + ' PACKED A LIMITED!';
    sub.innerText      = payload.cardName + ' · Serial #' + (payload.serial || '?') + ' / 10';

    // Render a mini card if we have enough data
    if (payload.cardData) {
        cardWrap.innerHTML = generateCardHtml(payload.cardData, false);
    } else {
        cardWrap.innerHTML = '<div style="color:#bebebe;font-size:2rem;padding:20px">🔒</div>';
    }

    overlay.classList.add('active');
    overlay.style.pointerEvents = 'all';

    // Clear any previous timer
    if (_lpaTimer) clearInterval(_lpaTimer);
    let remaining = 5;
    bar.style.width = '100%';
    countdown.innerText = 'CLOSING IN 5s';

    _lpaTimer = setInterval(() => {
        remaining -= 0.1;
        const pct = Math.max(0, (remaining / 5) * 100);
        bar.style.width = pct + '%';
        countdown.innerText = 'CLOSING IN ' + Math.ceil(remaining) + 's';
        if (remaining <= 0) {
            clearInterval(_lpaTimer);
            overlay.classList.remove('active');
            overlay.style.pointerEvents = 'none';
            cardWrap.innerHTML = '';
        }
    }, 100);
}

function renderOnlineList(presenceState) {
    const listEl = document.getElementById('active-players-list');
    if (!listEl) return;

    // Extract usernames from the presence state object
    const users = Object.values(presenceState).map(p => p[0].username);
    
    // Remove duplicates and render
    const uniqueUsers = [...new Set(users)];
    listEl.innerHTML = uniqueUsers.map(name => `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; font-size:0.85rem;">
            <span style="width:8px; height:8px; background:#3ecf8e; border-radius:50%; box-shadow:0 0 5px #3ecf8e;"></span>
            <span style="color:#eee; font-weight:bold;">${name.toUpperCase()}</span>
        </div>
    `).join('');
    
    // Update the count badge
    document.getElementById('online-count').innerText = uniqueUsers.length;
}

// Rating ranges per tier — used by both weight display and player list
const PACK_RATING_RANGES = {
    std:   { min: 70, max: 99, excludeRarities: ['Limited','1st edition','exchange'] },
    pre:   { min: 80, max: 99, excludeRarities: ['1st edition','exchange'] },
    elt:   { min: 84, max: 99, excludeRarities: ['1st edition','exchange'] },
    promo: { min: 84, max: 99, excludeRarities: ['exchange'] }  // promo includes 1st edition
};

function showPackWeights(tier) {
    const weights = {
        std:   { limited: "0%",    promo: "0%",   walkout: "2%",  floor: "70-86 Rating" },
        pre:   { limited: "0.01%", promo: "0%",   walkout: "10%", floor: "80-86 Rating" },
        elt:   { limited: "0.1%",  promo: "0%",   walkout: "50%", floor: "84-86 Rating" },
        promo: { limited: "0.2%",  promo: "20%",  walkout: "50%", floor: "84-86 Rating" }
    };
    const w = weights[tier];

    const modal = document.createElement('div');
    modal.id = "weight-modal";
    modal.style = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.9); display: flex; 
        align-items: flex-start; /* 🚀 CHANGED FROM center TO flex-start */
        justify-content: center; z-index: 10000; backdrop-filter: blur(10px);
        overflow-y: auto; padding: 40px 20px; /* Added more top padding */
        box-sizing: border-box;
    `;

    modal.innerHTML = `
        <div id="weight-modal-inner" style="background:#111;border:2px solid #3ecf8e;padding:30px;
             border-radius:20px;width:100%;max-width:860px;text-align:center;
             margin: auto; /* 🚀 ADDED margin: auto to center small content safely */
             box-shadow:0 0 30px rgba(62,207,142,0.2);">
            <h2 style="color:#3ecf8e;margin-bottom:5px;text-transform:uppercase;letter-spacing:3px;font-size:1.2rem;">
                ${tier.toUpperCase()} PACK</h2>
            <p style="color:#555;font-size:0.7rem;margin-bottom:25px;letter-spacing:1px;">
                OFFICIAL PROBABILITY DISTRIBUTION</p>

            <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:24px;">
                <div style="display:flex;justify-content:space-between;border-bottom:1px solid #222;padding-bottom:8px;">
                    <span style="color:#aaa;font-size:0.8rem;">Limited 1/10</span>
                    <span style="color:#fff;font-weight:bold;">${w.limited}</span>
                </div>
                <div style="display:flex;justify-content:space-between;border-bottom:1px solid #222;padding-bottom:8px;">
                    <span style="color:#aaa;font-size:0.8rem;">1st Edition</span>
                    <span style="color:#fff;font-weight:bold;">${w.promo}</span>
                </div>
                <div style="display:flex;justify-content:space-between;border-bottom:1px solid #222;padding-bottom:8px;">
                    <span style="color:#aaa;font-size:0.8rem;">Walkout (87+)</span>
                    <span style="color:#fff;font-weight:bold;">${w.walkout}</span>
                </div>
                <div style="display:flex;justify-content:space-between;border-bottom:1px solid #222;padding-bottom:8px;">
                    <span style="color:#aaa;font-size:0.8rem;">Pack Floor</span>
                    <span style="color:#555;font-size:0.8rem;">${w.floor}</span>
                </div>
            </div>

            <div style="display:flex;gap:12px;margin-bottom:20px;">
                <button class="btn" style="flex:1;background:#2a2a2a;color:#3ecf8e;border:1px solid #3ecf8e;padding:10px;"
                    onclick="showPackPlayerList('${tier}')">👁 VIEW PLAYERS IN THIS PACK</button>
                <button class="btn" style="flex:1;color:#000;padding:10px;"
                    onclick="document.getElementById('weight-modal').remove()">CLOSE</button>
            </div>

            <!-- Player list panel — hidden until button clicked -->
            <div id="pack-player-list" style="display:none;text-align:left;">
                <div style="font-size:0.65rem;color:#555;letter-spacing:2px;font-weight:900;margin-bottom:16px;text-align:center;">
                    ALL AVAILABLE PLAYERS · SORTED BY MARKET VALUE</div>
                <div id="pack-player-grid" style="
                    display:grid;grid-template-columns:repeat(auto-fill,180px);
                    gap:30px 30px;justify-content:center;"></div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

async function showPackPlayerList(tier) {
    const panel = document.getElementById('pack-player-list');
    const grid  = document.getElementById('pack-player-grid');
    if (!panel || !grid) return;

    panel.style.display = 'block';
    grid.innerHTML = '<div style="color:#555;text-align:center;padding:30px;grid-column:1/-1;">Loading players...</div>';

    const range = PACK_RATING_RANGES[tier];
    if (!range) return;

    let query = _supabase.from('soccer_stars').select('*')
        .gte('rating', range.min)
        .lte('rating', range.max)
        .eq('in_packs', true);

    // Exclude rarities not in this pack
    for (const r of range.excludeRarities) {
        query = query.neq('rarity', r);
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) {
        grid.innerHTML = '<div style="color:#555;text-align:center;padding:30px;grid-column:1/-1;">No players found.</div>';
        return;
    }

    // Sort by market value descending
    data.sort((a, b) => (b.base_price || 0) - (a.base_price || 0));
    grid.innerHTML = data.map(p => generateCardHtml(p, false)).join('');
}

        // ─── ARENA ───────────────────────────────────────────────────────────────

        function arenaShowPhase(id) {
            document.querySelectorAll('.arena-phase').forEach(p => p.classList.remove('active-phase'));
            document.getElementById(id).classList.add('active-phase');
        }

        function arenaToLobby() {
            arenaShowPhase('arena-lobby');
        }

        async function getStandardCardForBattle() {
            // Standard pack odds — same brackets as the store
            const roll = Math.random() * 100;
            let minR, maxR;
            if      (roll < 50)    { minR = 70; maxR = 79; }
            else if (roll < 80)    { minR = 80; maxR = 82; }
            else if (roll < 90)    { minR = 83; maxR = 83; }
            else if (roll < 95)    { minR = 84; maxR = 85; }
            else if (roll < 98)    { minR = 86; maxR = 86; }
            else if (roll < 99.5)  { minR = 87; maxR = 89; }
            else                   { minR = 90; maxR = 99; }

            const { data, error } = await _supabase
                .from('soccer_stars')
                .select('*')
                .gte('rating', minR)
                .lte('rating', maxR)
                .neq('rarity', 'Limited')
                .neq('rarity', '1st edition')
                .eq('in_packs', true);

            if (error || !data || data.length === 0) return null;
            const card = data[Math.floor(Math.random() * data.length)];
            if (card.rating >= 85 && Math.random() < 0.02) card.isSuperHolo = true;
            return card;
        }

        async function startArenaBattle() {
            const ENTRY = 500;
            const WIN_BONUS = 500;

            if (balance < ENTRY) {
                showToast(`⚠ You need ${ENTRY.toLocaleString()} 🪙 to enter.`, 4000);
                return;
            }

            balance -= ENTRY;
            updateUI();

            // ── PHASE: ROLLING ────────────────────────────────────────────────
            arenaShowPhase('arena-rolling');

            const labels = ['PULLING CARDS...', 'SCANNING DATABASE...', 'LOCKING IN...', 'ALMOST READY...'];
            let li = 0;
            const lblEl = document.getElementById('arena-rolling-lbl');
            const lblInterval = setInterval(() => { lblEl.innerText = labels[li++ % labels.length]; }, 600);

            // Fetch both cards + hold minimum drama time in parallel
            const [pCard, bCard] = await Promise.all([
                getStandardCardForBattle(),
                getStandardCardForBattle(),
                new Promise(r => setTimeout(r, 1600))
            ]);

            clearInterval(lblInterval);

            if (!pCard || !bCard) {
                balance += ENTRY;
                updateUI();
                arenaToLobby();
                showToast('❌ Connection error. Entry fee refunded.', 4000);
                return;
            }

            // ── PHASE: REVEAL ─────────────────────────────────────────────────
            pCard.instanceId    = 'inst_' + Date.now();
            pCard.collectedDate = new Date().toLocaleDateString();

            const pVal = getCardValue(pCard);
            const bVal = getCardValue(bCard);

            let bannerClass, bannerText, msg;
            if (pVal > bVal) {
                bannerClass = 'win';
                bannerText  = 'VICTORY';
                msg = `Your ${pCard.name} (${pVal.toLocaleString()} 🪙) beats Bot's ${bCard.name} (${bVal.toLocaleString()} 🪙). Card kept + ${WIN_BONUS.toLocaleString()} 🪙!`;
                balance += WIN_BONUS;
                mySquad.push(pCard);
                renderSquad();
            } else if (pVal === bVal) {
                bannerClass = 'tie';
                bannerText  = 'DRAW';
                msg = `Both pulled ${pVal.toLocaleString()} 🪙 value. Entry fee refunded.`;
                balance += ENTRY;
            } else {
                bannerClass = 'loss';
                bannerText  = 'DEFEAT';
                msg = `Bot's ${bCard.name} (${bVal.toLocaleString()} 🪙) beats your ${pCard.name} (${pVal.toLocaleString()} 🪙). Card burned.`;
            }

            updateUI();
            await saveGame();

            const banner = document.getElementById('arena-banner');
            banner.className = 'arena-banner ' + bannerClass;
            banner.innerText = bannerText;

            // Flip cards in with staggered animation
            document.getElementById('arena-card-player').innerHTML =
                `<div class="arena-flipin">${generateCardHtml(pCard, false)}</div>`;
            document.getElementById('arena-card-bot').innerHTML =
                `<div class="arena-flipin" style="animation-delay:0.18s">${generateCardHtml(bCard, false)}</div>`;

            const pValEl = document.getElementById('arena-val-player');
            const bValEl = document.getElementById('arena-val-bot');
            pValEl.innerText = pVal.toLocaleString() + ' 🪙';
            bValEl.innerText = bVal.toLocaleString() + ' 🪙';
            pValEl.style.color = pVal > bVal ? '#3ecf8e' : (pVal === bVal ? '#ffd700' : '#ef4444');
            bValEl.style.color = bVal > pVal ? '#3ecf8e' : (pVal === bVal ? '#ffd700' : '#555');

            document.getElementById('arena-result-msg').innerText = msg;
            arenaShowPhase('arena-reveal');
        }

        // ─── ARENA KEYBOARD SHORTCUTS ─────────────────────────────────────────────
        // Put this OUTSIDE the function!
        document.addEventListener('keydown', function(event) {
            // Check if the key pressed was 'Enter'
            if (event.key === 'Enter') {
                const revealPhase = document.getElementById('arena-reveal');
                // Only trigger if the reveal screen is currently active
                if (revealPhase && revealPhase.classList.contains('active-phase')) {
                    event.preventDefault(); // Stops Enter from accidentally clicking other focused buttons
                    startArenaBattle();
                }
            }
        });

        async function loadLimitedStock() {
    const banner = document.getElementById('limited-stock-banner');
    const list = document.getElementById('limited-stock-list');
    
    // 1. Fetch all players marked as 'Limited'
    const { data: limitedPlayers, error } = await _supabase
        .from('soccer_stars')
        .select('id, name')
        .ilike('rarity', 'Limited');

    if (error || !limitedPlayers || limitedPlayers.length === 0) {
        banner.style.display = 'none';
        return;
    }

    // 2. Clear current list and show banner
    list.innerHTML = '';
    banner.style.display = 'block';

    // 3. For each Limited player, check how many have been issued
    for (const player of limitedPlayers) {
        const { data: issuedCount } = await _supabase.rpc('count_limited_player', { pid: player.id });
        
        const remaining = 10 - (issuedCount || 0);
        const stockColor = remaining > 3 ? '#3ecf8e' : (remaining > 0 ? '#ffd700' : '#ef4444');

        // 4. Create the stock indicator pill
        const item = document.createElement('div');
        item.style = `
            background: rgba(255,255,255,0.05);
            border: 1px solid ${stockColor}44;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 0.65rem;
            font-weight: 900;
            display: flex;
            gap: 8px;
            align-items: center;
        `;
        
        item.innerHTML = `
            <span style="color: #888;">${player.name.toUpperCase()}</span>
            <span style="color: ${stockColor};">${remaining}/10 LEFT</span>
        `;
        
        list.appendChild(item);
    }
}

