// E型粘度計解析ツール アプリケーションロジック

// ==========================================
// 1. グローバル定数と初期設定 (プリセットデータ)
// ==========================================

const defaultRPMs = [100, 50, 20, 10, 5, 2.5, 1, 0.5];

// デフォルトのコーンパラメータ (E_type_viscometer.xlsx から抽出した値)
let coneParams = {
    "Cone(small)": {
        "KN": [512, 1024, 2560, 5120, 10240, 20480, 51200, 102400],
        "K0": [0.8533333333333334, 0.8533333333333334, 0.8533333333333333, 0.8533333333333333, 0.8533333333333333, 0.8533333333333333, 0.8533333333333334, 0.8533333333333334],
        "K1": [3.271972337030018, 3.271972337030018, 3.2719723370300176, 3.2719723370300176, 3.2719723370300176, 3.2719723370300176, 3.271972337030018, 3.271972337030018],
        "K2": [3.834342582457052, 3.834342582457052, 3.834342582457052, 3.834342582457052, 3.834342582457052, 3.834342582457052, 3.834342582457052, 3.834342582457052]
    },
    "Cone(large)": {
        "KN": [64, 128, 320, 640, 1280, 2560, 6400, 12800],
        "K0": [0.10666666666666667, 0.10666666666666667, 0.10666666666666666, 0.10666666666666666, 0.10666666666666666, 0.10666666666666666, 0.10666666666666667, 0.10666666666666667],
        "K1": [0.40899654212875225, 0.40899654212875225, 0.4089965421287522, 0.4089965421287522, 0.4089965421287522, 0.4089965421287522, 0.40899654212875225, 0.40899654212875225],
        "K2": [3.834342582457052, 3.834342582457052, 3.834342582457052, 3.834342582457052, 3.834342582457052, 3.834342582457052, 3.834342582457052, 3.834342582457052]
    }
};

// アプリケーション状態
let state = {
    rpms: [...defaultRPMs],
    coneType: "Cone(small)",
    numSamples: 4,
    sampleNames: ["チーズ", "クリーム", "バター", "とろろ"],
    // inputData[sampleIndex][rpmIndex] = theta
    inputData: [
        [100, 50, 10, 2, null, null, null, null], // チーズ
        [56, 20, 2, null, null, null, null, null], // クリーム
        [34, 11, null, null, null, null, null, null], // バター
        [46, 24, 11, null, null, null, null, null] // とろろ
    ],
    specs: {
        maker: "Blockfiled (販売代理店：東機産業)",
        meterType: "RV (EH-type)",
        rotorType: "E-type (Cone-Plate type)",
        rangeType: "H type",
        torqueDyn: 7187,
        torqueNm: 0.0007187
    },
    // 計算結果
    calcResults: {},
    activeSampleIndex: 0,
    activeTab: "flow" // flow, viscosity, bingham, casson, powerlaw
};

let chartInstance = null;
let calculationTimeout = null;

// モデルの特徴・適性の説明文
const MODEL_DESCRIPTIONS = {
    flow: "【流動曲線】せん断速度（D）とせん断応力（τ）の関係を示す基本的なグラフです。流体の性質（ニュートン性、擬塑性、ダイラタント性など）を直感的に把握できます。",
    viscosity: "【粘性曲線】せん断速度（D）に対する粘度（η）の変化を示すグラフです。非ニュートン流体の粘度がどのように変化するかを対数スケールで確認できます。",
    newtonian: "【Newtonianモデル】せん断応力とせん断速度が正比例し、粘度が常に一定となる理想的な粘性流体のモデル。水やシリコーンオイル、蜂蜜などに適応されます。",
    bingham: "【Binghamモデル】降伏応力（流動開始に必要な最小の力）を持つ塑性流体のモデル。ペンキ、ケチャップ、泥水などに適応。降伏応力を超えると一定の粘度で振る舞います。",
    casson: "【Cassonモデル】降伏応力を持ち、低せん断速度域での緩やかなカーブをBinghamより正確に表現できるモデル。チョコレート、血液、印刷インクなどによく用いられます。",
    powerlaw: "【Power-lawモデル】降伏応力を持たず、広い範囲で擬塑性（せん断速度上昇で粘度低下）やダイラタント性を示す流体のモデル。高分子溶液などに適応されます。",
    hb: "【Herschel-Bulkleyモデル】降伏応力を持ちつつ、流動開始後の非線形な粘度変化も表現できる、BinghamとPower-lawを組み合わせたモデル。マヨネーズ、グリスなどに適応。",
    cross: "【Crossモデル】極低せん断（ゼロせん断粘度）から極高せん断（無限せん断粘度）までの全領域の粘度挙動を表現できる4パラメータモデル。高分子融液や分散系など幅広く適応。",
    carreau: "【Carreauモデル】Crossと同様に全せん断領域を表現できる4パラメータモデル。Crossよりも遷移領域のカーブが滑らかで、多くのポリマー溶液やサスペンションに適応します。",
    compare: "【全モデル比較】すべての流動モデルの回帰指標（RMSE、MAE、決定係数）を一覧表示し、物理的妥当性とあわせて最適なモデルを評価します。"
};

// ==========================================
// 2. 数学・回帰分析ヘルパー関数
// ==========================================

// 一次線形回帰 (y = a*x + b)
function linearRegression(X, Y) {
    const N = X.length;
    if (N < 2) return { slope: 0, intercept: 0, r2: 0 };
    let sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0;
    for (let i = 0; i < N; i++) {
        sumX += X[i];
        sumY += Y[i];
        sumXX += X[i] * X[i];
        sumYY += Y[i] * Y[i];
        sumXY += X[i] * Y[i];
    }
    const denom = N * sumXX - sumX * sumX;
    if (denom === 0) return { slope: 0, intercept: 0, r2: 0 };
    const slope = (N * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / N;

    // R2 (決定係数) 計算
    const meanY = sumY / N;
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < N; i++) {
        const predY = slope * X[i] + intercept;
        ssTot += (Y[i] - meanY) * (Y[i] - meanY);
        ssRes += (Y[i] - predY) * (Y[i] - predY);
    }
    const r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);

    return { slope, intercept, r2 };
}

// 二次多項式回帰 (y = a*x^2 + b*x + c)
function solveQuadratic(X, Y) {
    const N = X.length;
    if (N < 3) {
        // データ不足時は線形回帰にフォールバック
        const lr = linearRegression(X, Y);
        return { a: 0, b: lr.slope, c: lr.intercept, r2: lr.r2 };
    }
    let sx = 0, sx2 = 0, sx3 = 0, sx4 = 0;
    let sy = 0, sxy = 0, sx2y = 0;
    for (let i = 0; i < N; i++) {
        const x = X[i];
        const y = Y[i];
        const x2 = x * x;
        sx += x;
        sx2 += x2;
        sx3 += x2 * x;
        sx4 += x2 * x2;
        sy += y;
        sxy += x * y;
        sx2y += x2 * y;
    }

    const detA = sx4 * (sx2 * N - sx * sx) - sx3 * (sx3 * N - sx2 * sx) + sx2 * (sx3 * sx - sx2 * sx2);
    if (Math.abs(detA) < 1e-12) {
        const lr = linearRegression(X, Y);
        return { a: 0, b: lr.slope, c: lr.intercept, r2: lr.r2 };
    }

    const detA0 = sx2y * (sx2 * N - sx * sx) - sx3 * (sxy * N - sy * sx) + sx2 * (sxy * sx - sy * sx2);
    const detA1 = sx4 * (sxy * N - sy * sx) - sx2y * (sx3 * N - sx2 * sx) + sx2 * (sx3 * sy - sx2 * sxy);
    const detA2 = sx4 * (sx2 * sy - sx * sxy) - sx3 * (sx3 * sy - sx2 * sxy) + sx2y * (sx3 * sx - sx2 * sx2);

    const a = detA0 / detA;
    const b = detA1 / detA;
    const c = detA2 / detA;

    // R2 計算
    const meanY = sy / N;
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < N; i++) {
        const predY = a * X[i] * X[i] + b * X[i] + c;
        ssTot += (Y[i] - meanY) * (Y[i] - meanY);
        ssRes += (Y[i] - predY) * (Y[i] - predY);
    }
    const r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);

    return { a, b, c, r2 };
}

// Herschel-Bulkleyモデル回帰分析 (τ = τy + K * D^n)
function solveHerschelBulkley(X, Y) {
    const N = X.length;
    if (N < 3) {
        // データ点が不足している場合は Bingham にフォールバック
        const lr = linearRegression(X, Y);
        return { tau_y: lr.intercept, K: lr.slope, n: 1.0, r2: lr.r2 };
    }

    const minY = Math.min(...Y);
    // tau_y の探索範囲上限。実測値の最小値よりわずかに小さくする。
    const maxTauY = minY > 0 ? minY * 0.9999 : 0;

    let bestR2 = -Infinity;
    let bestTauY = 0;
    let bestK = 0;
    let bestN = 0;

    const steps = 500;

    for (let i = 0; i <= steps; i++) {
        const tau_y = maxTauY * (i / steps);
        const lnX = [];
        const lnYMinusTauY = [];
        let valid = true;

        for (let j = 0; j < N; j++) {
            const diff = Y[j] - tau_y;
            if (diff <= 0 || X[j] <= 0) {
                valid = false;
                break;
            }
            lnX.push(Math.log(X[j]));
            lnYMinusTauY.push(Math.log(diff));
        }

        if (!valid) continue;

        const lr = linearRegression(lnX, lnYMinusTauY);

        // K > 0, n > 0 である妥当な解の中で決定係数 R2 が最大のものを選ぶ
        if (lr.slope > 0 && lr.r2 > bestR2) {
            bestR2 = lr.r2;
            bestTauY = tau_y;
            bestK = Math.exp(lr.intercept);
            bestN = lr.slope;
        }
    }

    // 万が一解が見つからなかった場合は線形回帰にフォールバック
    if (bestR2 === -Infinity) {
        const lr = linearRegression(X, Y);
        return { tau_y: lr.intercept, K: lr.slope, n: 1.0, r2: lr.r2 };
    }

    return { tau_y: bestTauY, K: bestK, n: bestN, r2: bestR2 };
}

// Nelder-Mead (滑降シンプレックス法) による非線形最適化
// objectiveFunc: 最小化する目的関数 f(params)
// initialGuess: パラメータの初期値の配列 [p1, p2, ...]
function nelderMead(objectiveFunc, initialGuess) {
    const N = initialGuess.length;
    let simplex = [];
    
    const initVal = objectiveFunc(initialGuess);
    simplex.push({ pt: [...initialGuess], val: initVal });
    
    for (let i = 0; i < N; i++) {
        let pt = [...initialGuess];
        pt[i] = pt[i] === 0 ? 0.00025 : pt[i] * 1.05;
        simplex.push({ pt: pt, val: objectiveFunc(pt) });
    }
    
    const alpha = 1.0;
    const gamma = 2.0;
    const rho = 0.5;
    const sigma = 0.5;
    
    let iter = 0;
    const maxIter = 3000;
    const tol = 1e-6;
    
    while (iter < maxIter) {
        simplex.sort((a, b) => a.val - b.val);
        
        const diff = Math.abs(simplex[N].val - simplex[0].val);
        if (diff < tol) break;
        
        let centroid = new Array(N).fill(0);
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                centroid[j] += simplex[i].pt[j];
            }
        }
        for (let j = 0; j < N; j++) centroid[j] /= N;
        
        const worst = simplex[N].pt;
        
        let refPt = new Array(N);
        for (let j = 0; j < N; j++) refPt[j] = centroid[j] + alpha * (centroid[j] - worst[j]);
        const refVal = objectiveFunc(refPt);
        
        if (refVal >= simplex[0].val && refVal < simplex[N-1].val) {
            simplex[N] = { pt: refPt, val: refVal };
        } else if (refVal < simplex[0].val) {
            let expPt = new Array(N);
            for (let j = 0; j < N; j++) expPt[j] = centroid[j] + gamma * (refPt[j] - centroid[j]);
            const expVal = objectiveFunc(expPt);
            if (expVal < refVal) {
                simplex[N] = { pt: expPt, val: expVal };
            } else {
                simplex[N] = { pt: refPt, val: refVal };
            }
        } else {
            let conPt = new Array(N);
            for (let j = 0; j < N; j++) conPt[j] = centroid[j] + rho * (worst[j] - centroid[j]);
            const conVal = objectiveFunc(conPt);
            if (conVal < simplex[N].val) {
                simplex[N] = { pt: conPt, val: conVal };
            } else {
                const best = simplex[0].pt;
                for (let i = 1; i <= N; i++) {
                    for (let j = 0; j < N; j++) {
                        simplex[i].pt[j] = best[j] + sigma * (simplex[i].pt[j] - best[j]);
                    }
                    simplex[i].val = objectiveFunc(simplex[i].pt);
                }
            }
        }
        iter++;
    }
    
    simplex.sort((a, b) => a.val - b.val);
    return simplex[0].pt;
}

// Crossモデル: eta = eta_inf + (eta_0 - eta_inf) / (1 + (K * D)^m)
function solveCrossModel(D_vals, eta_vals) {
    const N = D_vals.length;
    if (N < 4) return { eta_0: 0, eta_inf: 0, K: 0, m: 1, r2: 0 };
    
    let minD_idx = 0;
    let maxD_idx = 0;
    for (let i = 1; i < N; i++) {
        if (D_vals[i] < D_vals[minD_idx]) minD_idx = i;
        if (D_vals[i] > D_vals[maxD_idx]) maxD_idx = i;
    }
    let guess_eta_0 = eta_vals[minD_idx];
    let guess_eta_inf = eta_vals[maxD_idx];
    
    const sortedD = [...D_vals].sort((a,b) => a-b);
    const medianD = sortedD[Math.floor(N/2)] || 1;
    
    let initGuess = [guess_eta_0, guess_eta_inf, 1.0 / medianD, 1.0];
    
    const objFunc = (params) => {
        let [eta_0, eta_inf, K, m] = params;
        if (eta_0 < 0 || eta_inf < 0 || K < 0 || m < 0) return 1e20;
        
        let sse = 0;
        for (let i = 0; i < N; i++) {
            let D = D_vals[i];
            let eta_pred = eta_inf + (eta_0 - eta_inf) / (1 + Math.pow(K * D, m));
            let err = eta_vals[i] - eta_pred;
            sse += err * err;
        }
        return sse;
    };
    
    let bestParams = nelderMead(objFunc, initGuess);
    
    let meanY = eta_vals.reduce((a,b)=>a+b, 0) / N;
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < N; i++) {
        let D = D_vals[i];
        let [eta_0, eta_inf, K, m] = bestParams;
        let eta_pred = eta_inf + (eta_0 - eta_inf) / (1 + Math.pow(K * D, m));
        ssTot += Math.pow(eta_vals[i] - meanY, 2);
        ssRes += Math.pow(eta_vals[i] - eta_pred, 2);
    }
    let r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);
    
    return { eta_0: bestParams[0], eta_inf: bestParams[1], K: bestParams[2], m: bestParams[3], r2: r2 };
}

// Carreauモデル: eta = eta_inf + (eta_0 - eta_inf) * (1 + (lambda * D)^2)^((n-1)/2)
function solveCarreauModel(D_vals, eta_vals) {
    const N = D_vals.length;
    if (N < 4) return { eta_0: 0, eta_inf: 0, lambda: 0, n: 1, r2: 0 };
    
    let minD_idx = 0;
    let maxD_idx = 0;
    for (let i = 1; i < N; i++) {
        if (D_vals[i] < D_vals[minD_idx]) minD_idx = i;
        if (D_vals[i] > D_vals[maxD_idx]) maxD_idx = i;
    }
    let guess_eta_0 = eta_vals[minD_idx];
    let guess_eta_inf = eta_vals[maxD_idx];
    
    const sortedD = [...D_vals].sort((a,b) => a-b);
    const medianD = sortedD[Math.floor(N/2)] || 1;
    
    let initGuess = [guess_eta_0, guess_eta_inf, 1.0 / medianD, 1.0];
    
    const objFunc = (params) => {
        let [eta_0, eta_inf, lambda, n] = params;
        if (eta_0 < 0 || eta_inf < 0 || lambda < 0) return 1e20;
        
        let sse = 0;
        for (let i = 0; i < N; i++) {
            let D = D_vals[i];
            let eta_pred = eta_inf + (eta_0 - eta_inf) * Math.pow(1 + Math.pow(lambda * D, 2), (n - 1) / 2);
            let err = eta_vals[i] - eta_pred;
            sse += err * err;
        }
        return sse;
    };
    
    let bestParams = nelderMead(objFunc, initGuess);
    
    let meanY = eta_vals.reduce((a,b)=>a+b, 0) / N;
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < N; i++) {
        let D = D_vals[i];
        let [eta_0, eta_inf, lambda, n] = bestParams;
        let eta_pred = eta_inf + (eta_0 - eta_inf) * Math.pow(1 + Math.pow(lambda * D, 2), (n - 1) / 2);
        ssTot += Math.pow(eta_vals[i] - meanY, 2);
        ssRes += Math.pow(eta_vals[i] - eta_pred, 2);
    }
    let r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);
    
    return { eta_0: bestParams[0], eta_inf: bestParams[1], lambda: bestParams[2], n: bestParams[3], r2: r2 };
}


// ==========================================
// 3. UIレンダリング・操作ロジック
// ==========================================

// アプリ起動時の初期化
document.addEventListener("DOMContentLoaded", () => {
    // === サイドバー開閉ロジック ===
    const sidebarToggleBtn = document.getElementById("sidebar-toggle-btn");
    const sidebarBackdrop = document.getElementById("sidebar-backdrop");
    const leftColumn = document.querySelector(".left-column");

    function toggleSidebar() {
        leftColumn.classList.toggle("open");
        sidebarBackdrop.classList.toggle("show");
    }

    if (sidebarToggleBtn && sidebarBackdrop && leftColumn) {
        sidebarToggleBtn.addEventListener("click", toggleSidebar);
        sidebarBackdrop.addEventListener("click", toggleSidebar);
    }
    // ============================

    // Lucideアイコンの読み込み (オフラインなどでCDNが読めない場合の対策)
    if (typeof lucide !== "undefined") {
        try {
            lucide.createIcons();
        } catch (e) {
            console.error("Lucideアイコンの作成に失敗しました", e);
        }
    }
    
    // ローカルストレージから状態の復元
    loadFromLocalStorage();
    
    // コーン選択ドロップダウンの更新 (復元されたカスタムコーンを含む)
    updateConeDropdown();
    const coneSelect = document.getElementById("cone-select");
    if (coneSelect) {
        coneSelect.value = state.coneType;
    }
    
    // 粘度計仕様UIの初期表示更新
    updateSpecsUI();
    
    // イベントリスナーの登録
    initEventListeners();
    
    // UIの描画
    renderInputTable();
    renderSampleTabs();
    calculate();
});

// イベントリスナー設定
function initEventListeners() {
    // コーン選択ドロップダウン変更
    const coneSelect = document.getElementById("cone-select");
    if (coneSelect) {
        coneSelect.addEventListener("change", (e) => {
            const val = e.target.value;
            if (val === "create_new") {
                // 新規追加モーダルを表示
                showConeModal();
                // 選択状態を元のコーン値に戻しておく (キャンセルに備えて)
                coneSelect.value = state.coneType;
            } else {
                state.coneType = val;
                saveToLocalStorage();
                calculate();
            }
        });
    }

    // 新規コーンモーダルのイベント登録
    document.getElementById("modal-close-x-btn").addEventListener("click", hideConeModal);
    document.getElementById("modal-cancel-btn").addEventListener("click", hideConeModal);
    document.getElementById("modal-save-btn").addEventListener("click", saveNewCone);
    document.getElementById("apply-template-small").addEventListener("click", () => applyTemplate("Cone(small)"));
    document.getElementById("apply-template-large").addEventListener("click", () => applyTemplate("Cone(large)"));

    // 新規コーン物理仕様の入力変更イベント（自動計算トリガー）
    ["new-cone-radius", "new-cone-angle"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("input", (e) => {
                recalculateConeConstants();
            });
        }
    });

    // 粘度計仕様用ボタン
    const specDefaultBtn = document.getElementById("spec-default-btn");
    if (specDefaultBtn) specDefaultBtn.addEventListener("click", loadDefaultSpecs);
    
    const specSaveCsvBtn = document.getElementById("spec-save-csv-btn");
    if (specSaveCsvBtn) specSaveCsvBtn.addEventListener("click", saveSpecsCSV);
    
    const specCsvInput = document.getElementById("spec-csv-input");
    if (specCsvInput) specCsvInput.addEventListener("change", loadSpecsCSV);

    // 粘度計仕様テーブルの入力変更イベント
    ["spec-maker", "spec-meter-type", "spec-rotor-type", "spec-range-type"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("change", (e) => {
                const key = id.replace("spec-", "").replace(/-([a-z])/g, g => g[1].toUpperCase());
                state.specs[key] = e.target.value;
                saveToLocalStorage();
                calculate(); // リアルタイム反映
            });
        }
    });

    // トルク値の相互連動とばね定数計算
    const torqueDynEl = document.getElementById("spec-torque-dyn");
    const torqueNmEl = document.getElementById("spec-torque-nm");
    if (torqueDynEl && torqueNmEl) {
        torqueDynEl.addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            state.specs.torqueDyn = isNaN(val) ? null : val;
            state.specs.torqueNm = isNaN(val) ? null : val * 1e-7;
            torqueNmEl.value = isNaN(val) ? "" : (val * 1e-7).toFixed(9);
            updateCalculatedSpringK();
            saveToLocalStorage();
            calculate(); // リアルタイム反映
        });
        torqueNmEl.addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            state.specs.torqueNm = isNaN(val) ? null : val;
            state.specs.torqueDyn = isNaN(val) ? null : Math.round(val / 1e-7);
            torqueDynEl.value = isNaN(val) ? "" : Math.round(val / 1e-7);
            updateCalculatedSpringK();
            saveToLocalStorage();
            calculate(); // リアルタイム反映
        });
    }

    // RPM設定の変更連動
    const rpmSetEl = document.getElementById("spec-rpm-set");
    if (rpmSetEl) {
        rpmSetEl.addEventListener("change", (e) => {
            const valStr = e.target.value;
            const newRpms = valStr.split(",")
                                  .map(s => parseFloat(s.trim()))
                                  .filter(n => !isNaN(n) && n > 0);
            
            if (newRpms.length > 0) {
                const newLength = newRpms.length;
                state.inputData = state.inputData.map(row => {
                    const newRow = new Array(newLength).fill(null);
                    newRpms.forEach((rpm, newIdx) => {
                        const oldIdx = state.rpms.indexOf(rpm);
                        if (oldIdx !== -1) {
                            newRow[newIdx] = row[oldIdx];
                        }
                    });
                    return newRow;
                });
                
                state.rpms = newRpms;
                // 全コーンのパラメータを新しいRPMに合わせて再計算する
                recalcAllConeParamsForNewRpms();
                
                saveToLocalStorage();
                renderInputTable();
                calculate();
            } else {
                e.target.value = state.rpms.join(", ");
            }
        });
    }

    // サンプル列の追加・削除
    document.getElementById("sample-add-btn").addEventListener("click", addSampleColumn);
    document.getElementById("sample-remove-btn").addEventListener("click", removeSampleColumn);
    document.getElementById("load-sample-btn").addEventListener("click", loadSampleData);

    // 各種アクションボタン
    document.getElementById("save-csv-btn").addEventListener("click", saveCSV);
    document.getElementById("load-csv-btn").addEventListener("click", () => {
        document.getElementById("csv-file-input").click();
    });
    document.getElementById("csv-file-input").addEventListener("change", loadCSV);

    // モデル説明文の更新関数
    function updateModelDescription(tabId) {
        const descBox = document.getElementById("model-description-box");
        if (descBox && MODEL_DESCRIPTIONS[tabId]) {
            descBox.textContent = MODEL_DESCRIPTIONS[tabId];
            descBox.style.display = "block";
        } else if (descBox) {
            descBox.style.display = "none";
        }
    }

    // グラフタブ切り替え
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            e.target.classList.add("active");
            state.activeTab = e.target.dataset.tab;
            updateModelDescription(state.activeTab);
            renderChart();
        });
    });
    
    // 初期タブの説明文を表示
    updateModelDescription(state.activeTab);

    // メインビュータブ切り替え（データ出力 vs グラフ解析）
    document.querySelectorAll(".view-tab-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            document.querySelectorAll(".view-tab-btn").forEach(b => b.classList.remove("active"));
            const targetBtn = e.currentTarget;
            targetBtn.classList.add("active");
            
            const view = targetBtn.dataset.view;
            document.getElementById("panel-input").style.display = view === "input" ? "flex" : "none";
            document.getElementById("panel-result").style.display = view === "result" ? "flex" : "none";
            document.getElementById("panel-graph").style.display = view === "graph" ? "flex" : "none";
            
            // グラフが表示された時にリサイズを促す
            if (view === "graph" && window.myChart) {
                window.myChart.resize();
            }
        });
    });
}

// 入力テーブルのレンダリング
function renderInputTable() {
    const headerRow = document.getElementById("input-table-header");
    const tableBody = document.getElementById("input-table-body");

    // ヘッダー行（サンプルNo.）の構築
    headerRow.innerHTML = `<th class="sticky-col">サンプルNo.</th>`;
    state.sampleNames.forEach((name, idx) => {
        const th = document.createElement("th");
        th.className = "text-center";
        th.innerText = `${idx + 1}`;
        headerRow.appendChild(th);
    });

    // ボディ行の構築
    tableBody.innerHTML = "";
    
    // サンプル名（編集可能）の行を追加
    const labelRow = document.createElement("tr");
    labelRow.innerHTML = `<td class="sticky-col font-bold" style="font-size: 0.85rem; color: var(--text-muted);">サンプル名</td>`;
    state.sampleNames.forEach((name, idx) => {
        const td = document.createElement("td");
        td.innerHTML = `<input type="text" class="cell-input text-center sample-name-input" value="${name}" data-sample-idx="${idx}" placeholder="サンプル名">`;
        labelRow.appendChild(td);
    });
    tableBody.appendChild(labelRow);

    // サンプル名の変更検知
    labelRow.querySelectorAll(".sample-name-input").forEach(input => {
        input.addEventListener("change", (e) => {
            const idx = parseInt(e.target.dataset.sampleIdx);
            state.sampleNames[idx] = e.target.value || `Sample #${idx + 1}`;
            saveToLocalStorage();
            renderSampleTabs();
            calculate();
        });
    });

    // 各RPM行の追加
    state.rpms.forEach((rpm, rpmIdx) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td class="sticky-col font-bold">${rpm} <span style="font-size: 0.7em; color: var(--text-muted); font-weight: normal;">rpm</span></td>`;
        
        state.sampleNames.forEach((_, sampleIdx) => {
            const td = document.createElement("td");
            const val = state.inputData[sampleIdx][rpmIdx];
            const valStr = val !== null ? val : "";
            
            td.innerHTML = `<input type="number" step="any" class="cell-input text-cell" value="${valStr}" data-sample-idx="${sampleIdx}" data-rpm-idx="${rpmIdx}" placeholder="-">`;
            tr.appendChild(td);
        });
        tableBody.appendChild(tr);
    });

    // 数値セルの値変更検知
    tableBody.querySelectorAll(".text-cell").forEach(input => {
        input.addEventListener("input", (e) => {
            const sIdx = parseInt(e.target.dataset.sampleIdx);
            const rIdx = parseInt(e.target.dataset.rpmIdx);
            const val = parseFloat(e.target.value);
            state.inputData[sIdx][rIdx] = isNaN(val) ? null : val;
            saveToLocalStorage();
            calculate(); // リアルタイム反映
        });
    });
}

// データ出力側のサンプル選択タブのレンダリング
function renderSampleTabs() {
    const container = document.getElementById("sample-selector-container");
    container.innerHTML = "";
    
    state.sampleNames.forEach((name, idx) => {
        const btn = document.createElement("button");
        btn.className = `sample-tab-btn ${state.activeSampleIndex === idx ? "active" : ""}`;
        btn.innerText = name;
        btn.addEventListener("click", () => {
            state.activeSampleIndex = idx;
            document.querySelectorAll(".sample-tab-btn").forEach((b, i) => {
                b.classList.toggle("active", i === idx);
            });
            const titleEl = document.getElementById("result-table-title");
            titleEl.innerText = `データ出力：${name}`;
            renderResultTable(name);
            renderChart();
        });
        container.appendChild(btn);
    });
}

// 結果テーブルのレンダリング
function renderResultTable(sampleName) {
    const tableBody = document.getElementById("result-table-body");
    tableBody.innerHTML = "";

    const results = state.calcResults[sampleName] || [];
    
    // ヘッダー単位行の挿入
    const unitRow = document.createElement("tr");
    unitRow.innerHTML = `
        <td class="font-bold" style="color: var(--text-muted);">rpm</td>
        <td class="font-bold" style="color: var(--text-muted);">1/s</td>
        <td class="font-bold" style="color: var(--text-muted);">Pa·s</td>
        <td class="font-bold" style="color: var(--text-muted);">Pa</td>
    `;
    tableBody.appendChild(unitRow);

    // データ行の挿入
    results.forEach(row => {
        const tr = document.createElement("tr");
        const rpm = row.rpm;
        const D = row.D !== null ? row.D.toFixed(3) : "";
        const eta = row.eta !== null ? row.eta.toFixed(3) : "";
        const tau = row.tau !== null ? row.tau.toFixed(2) : "";

        tr.innerHTML = `
            <td class="font-bold">${rpm} <span style="font-size: 0.7em; color: var(--text-muted); font-weight: normal;">rpm</span></td>
            <td>${D}</td>
            <td>${eta}</td>
            <td>${tau}</td>
        `;
        tableBody.appendChild(tr);
    });
}

// サンプル列の追加
function addSampleColumn() {
    state.numSamples++;
    const newName = `Sample #${state.numSamples}`;
    state.sampleNames.push(newName);
    state.inputData.push(new Array(state.rpms.length).fill(null));
    saveToLocalStorage();
    renderInputTable();
    renderSampleTabs();
    calculate();
}

// サンプル列の削除
function removeSampleColumn() {
    if (state.numSamples <= 1) return;
    state.numSamples--;
    state.sampleNames.pop();
    state.inputData.pop();
    if (state.activeSampleIndex >= state.numSamples) {
        state.activeSampleIndex = state.numSamples - 1;
    }
    saveToLocalStorage();
    renderInputTable();
    renderSampleTabs();
    calculate();
}

// ==========================================
// 4. 計算処理ロジック
// ==========================================

function calculate() {
    state.calcResults = {};
    const params = coneParams[state.coneType];

    state.sampleNames.forEach((sampleName, sampleIdx) => {
        const resultList = [];
        state.rpms.forEach((rpm, rpmIdx) => {
            const val = state.inputData[sampleIdx][rpmIdx];
            if (val === null || val === undefined || isNaN(val)) {
                resultList.push({ rpm, D: null, eta: null, tau: null });
            } else {
                const theta = val;
                const KN_val = params.KN[rpmIdx] || 0;
                const K1_val = params.K1[rpmIdx] || 0;
                const K2_val = params.K2[rpmIdx] || 0;

                const D = (K2_val * rpm) / 60;
                const eta = (KN_val * theta) / 1000;
                const tau = K1_val * theta;

                resultList.push({ rpm, D, eta, tau });
            }
        });
        state.calcResults[sampleName] = resultList;
    });

    const activeSampleName = state.sampleNames[state.activeSampleIndex];
    const titleEl = document.getElementById("result-table-title");
    titleEl.innerText = `データ出力：${activeSampleName}`;

    renderResultTable(activeSampleName);
    renderChart();
}

// ==========================================
// 5. グラフ描画とフィッティング解析
// ==========================================

// LaTeX数式のレンダリング用ヘルパー (KaTeX利用)
function renderFormula(latexString) {
    const el = document.getElementById("fitting-equation-box");
    if (!el) return;
    if (typeof katex !== "undefined") {
        try {
            katex.render(latexString, el, {
                throwOnError: false,
                displayMode: true
            });
        } catch (e) {
            el.innerText = latexString;
        }
    } else {
        el.innerText = latexString;
    }
}

// ==========================================
// 全モデル比較用ロジック
// ==========================================
function solveNewtonian(D_vals, tau_vals) {
    let sumXX = 0;
    let sumXY = 0;
    for (let i = 0; i < D_vals.length; i++) {
        sumXX += D_vals[i] * D_vals[i];
        sumXY += D_vals[i] * tau_vals[i];
    }
    const eta_0 = sumXX === 0 ? 0 : sumXY / sumXX;
    
    let meanY = 0;
    for (let i = 0; i < tau_vals.length; i++) meanY += tau_vals[i];
    meanY /= tau_vals.length;
    
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < tau_vals.length; i++) {
        const predY = eta_0 * D_vals[i];
        ssTot += Math.pow(tau_vals[i] - meanY, 2);
        ssRes += Math.pow(tau_vals[i] - predY, 2);
    }
    const r2 = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);
    return { eta_0, r2 };
}

function evaluateModel(modelName, fitResult, D_obs, tau_obs) {
    let requiredParams = 2;
    let isValid = true;
    let invalidReason = "";

    if (!fitResult || fitResult.r2 === -Infinity || isNaN(fitResult.r2)) {
        return { rating: "invalid", note: "フィッティング不能", r2: NaN, rmse: NaN, mae: NaN };
    }

    // パラメータ物理的妥当性チェック
    switch (modelName) {
        case 'newtonian':
            requiredParams = 1;
            if (fitResult.eta_0 < 0) { isValid = false; invalidReason = "物理的矛盾 (η0<0)"; }
            break;
        case 'bingham':
            requiredParams = 2;
            if (fitResult.tau_y < 0 || fitResult.eta_p < 0) { isValid = false; invalidReason = "物理的矛盾 (τy<0 または ηp<0)"; }
            break;
        case 'casson':
            requiredParams = 2;
            if (fitResult.tau_y_raw < 0 || fitResult.eta_p_raw < 0) { isValid = false; invalidReason = "物理的矛盾 (√τy<0 または √ηc<0)"; }
            break;
        case 'powerlaw':
            requiredParams = 2;
            if (fitResult.K < 0 || fitResult.n < 0) { isValid = false; invalidReason = "物理的矛盾 (K<0 または n<0)"; }
            break;
        case 'hb':
            requiredParams = 3;
            if (fitResult.tau_y < 0 || fitResult.K < 0 || fitResult.n < 0) { isValid = false; invalidReason = "物理的矛盾 (負のパラメータ)"; }
            break;
        case 'cross':
            requiredParams = 4;
            if (fitResult.eta_0 < 0 || fitResult.eta_inf < 0 || fitResult.eta_inf > fitResult.eta_0 || fitResult.K < 0 || fitResult.m < 0) { 
                isValid = false; invalidReason = "物理的矛盾 (η0, η∞の逆転または負値)"; 
            }
            break;
        case 'carreau':
            requiredParams = 4;
            if (fitResult.eta_0 < 0 || fitResult.eta_inf < 0 || fitResult.eta_inf > fitResult.eta_0 || fitResult.lambda < 0 || fitResult.n < 0) { 
                isValid = false; invalidReason = "物理的矛盾 (η0, η∞の逆転または負値)"; 
            }
            break;
    }

    if (D_obs.length <= requiredParams) {
        return { rating: "insufficient", note: `データ不足 (点数≤${requiredParams})`, r2: NaN, rmse: NaN, mae: NaN };
    }
    
    if (!isValid) {
        return { rating: "invalid", note: invalidReason, r2: fitResult.r2, rmse: NaN, mae: NaN };
    }

    // 予測値(tau)の計算とRMSE, MAEの算出
    let sum_sq_err = 0;
    let sum_abs_err = 0;
    let valid_count = 0;

    for (let i = 0; i < D_obs.length; i++) {
        let D = D_obs[i];
        if (D <= 0) continue; // ゼロせん断は除外
        let p_tau = 0;
        switch (modelName) {
            case 'newtonian': p_tau = fitResult.eta_0 * D; break;
            case 'bingham': p_tau = fitResult.tau_y + fitResult.eta_p * D; break;
            case 'casson': 
                let sqrt_tau = Math.sqrt(fitResult.tau_y) + Math.sqrt(fitResult.eta_p * D);
                p_tau = sqrt_tau * sqrt_tau;
                break;
            case 'powerlaw': p_tau = fitResult.K * Math.pow(D, fitResult.n); break;
            case 'hb': p_tau = fitResult.tau_y + fitResult.K * Math.pow(D, fitResult.n); break;
            case 'cross': 
                let p_eta_cross = fitResult.eta_inf + (fitResult.eta_0 - fitResult.eta_inf) / (1 + Math.pow(fitResult.K * D, fitResult.m)); 
                p_tau = p_eta_cross * D;
                break;
            case 'carreau': 
                let p_eta_carreau = fitResult.eta_inf + (fitResult.eta_0 - fitResult.eta_inf) * Math.pow(1 + Math.pow(fitResult.lambda * D, 2), (fitResult.n - 1) / 2); 
                p_tau = p_eta_carreau * D;
                break;
        }
        
        let err = tau_obs[i] - p_tau;
        sum_sq_err += err * err;
        sum_abs_err += Math.abs(err);
        valid_count++;
    }

    let rmse = valid_count > 0 ? Math.sqrt(sum_sq_err / valid_count) : NaN;
    let mae = valid_count > 0 ? sum_abs_err / valid_count : NaN;
    let r2 = fitResult.r2;

    let rating = "poor";
    let note = "";
    if (r2 >= 0.99) rating = "excellent";
    else if (r2 >= 0.95) rating = "good";
    else if (r2 >= 0.90) rating = "fair";

    return { rating, r2, rmse, mae, note };
}

function calculateAllModelsMetrics(validPoints) {
    if (validPoints.length === 0) return [];

    const D_vals = validPoints.map(p => p.D);
    const tau_vals = validPoints.map(p => p.tau);
    const eta_vals = validPoints.map(p => p.eta);

    // 0. Newtonian
    const fitNewtonian = solveNewtonian(D_vals, tau_vals);

    // 1. Bingham
    const lrB = linearRegression(D_vals, tau_vals);
    const fitBingham = { tau_y: lrB.intercept, eta_p: lrB.slope, r2: lrB.r2 };
    
    // 2. Casson
    const sqrtD = D_vals.map(x => Math.sqrt(x));
    const sqrtTau = tau_vals.map(y => Math.sqrt(y));
    const lrC = linearRegression(sqrtD, sqrtTau);
    const fitCasson = { 
        tau_y_raw: lrC.intercept,
        eta_p_raw: lrC.slope,
        tau_y: Math.pow(Math.max(0, lrC.intercept), 2), 
        eta_p: Math.pow(Math.max(0, lrC.slope), 2), 
        r2: lrC.r2 
    };

    // 3. Power-law
    const validPlPoints = validPoints.filter(p => p.D > 0 && p.tau > 0);
    let fitPowerLaw = null;
    if (validPlPoints.length >= 2) {
        const lnD = validPlPoints.map(p => Math.log(p.D));
        const lnTau = validPlPoints.map(p => Math.log(p.tau));
        const lrP = linearRegression(lnD, lnTau);
        fitPowerLaw = { K: Math.exp(lrP.intercept), n: lrP.slope, r2: lrP.r2 };
    }

    // 4. Herschel-Bulkley
    const fitHB = solveHerschelBulkley(D_vals, tau_vals);

    // 5. Cross
    const fitCross = solveCrossModel(D_vals, eta_vals);

    // 6. Carreau
    const fitCarreau = solveCarreauModel(D_vals, eta_vals);

    return [
        { modelId: "newtonian", name: "Newtonian", fit: fitNewtonian },
        { modelId: "bingham", name: "Bingham", fit: fitBingham },
        { modelId: "casson", name: "Casson", fit: fitCasson },
        { modelId: "powerlaw", name: "Power-law", fit: fitPowerLaw },
        { modelId: "hb", name: "Herschel-Bulkley", fit: fitHB },
        { modelId: "cross", name: "Cross", fit: fitCross },
        { modelId: "carreau", name: "Carreau", fit: fitCarreau }
    ].map(item => {
        const evalRes = evaluateModel(item.modelId, item.fit, D_vals, tau_vals);
        return { ...item, ...evalRes };
    });
}

function renderChart() {
    const canvas = document.getElementById("chart-canvas");
    const fittingPanel = document.getElementById("fitting-info-panel");
    const fittingGrid = document.getElementById("fitting-results-grid");
    const compareTableContainer = document.getElementById("compare-table-container");
    const mainChartContainer = document.getElementById("main-chart-container");
    
    if (chartInstance) {
        chartInstance.destroy();
    }

    const activeSampleName = state.sampleNames[state.activeSampleIndex];
    const dataList = state.calcResults[activeSampleName] || [];

    // プロット可能な有効データをフィルタリング
    const validPoints = dataList.filter(d => d.D !== null && d.tau !== null && d.eta !== null);
    
    if (validPoints.length === 0) {
        fittingPanel.style.display = "none";
        compareTableContainer.style.display = "none";
        mainChartContainer.style.display = "block";
        // データが無い状態の空グラフを描画
        chartInstance = new Chart(canvas, {
            type: 'scatter',
            data: { datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: { display: true, text: 'データが入力されていません', color: '#94a3b8' }
                },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { grid: { color: 'rgba(255,255,255,0.05)' } }
                }
            },
            plugins: [academicBoxPlugin]
        });
        return;
    }

    if (state.activeTab === "compare") {
        fittingPanel.style.display = "none";
        mainChartContainer.style.display = "none";
        compareTableContainer.style.display = "block";

        const metrics = calculateAllModelsMetrics(validPoints);
        const tbody = document.querySelector("#compare-table tbody");
        tbody.innerHTML = "";

        metrics.forEach(m => {
            const tr = document.createElement("tr");
            
            let ratingIcon = "";
            let ratingClass = "";
            switch(m.rating) {
                case "excellent": ratingIcon = "◎"; ratingClass = "rating-excellent"; break;
                case "good": ratingIcon = "〇"; ratingClass = "rating-good"; break;
                case "fair": ratingIcon = "△"; ratingClass = "rating-fair"; break;
                case "poor": ratingIcon = "×"; ratingClass = "rating-poor"; break;
                case "invalid": ratingIcon = "×"; ratingClass = "rating-invalid"; break;
                case "insufficient": ratingIcon = "ー"; ratingClass = "rating-invalid"; break;
            }

            let noteHtml = m.note ? `<span class="${m.rating === 'invalid' ? 'note-invalid' : 'note-insufficient'}">${m.note}</span>` : "";

            const r2Str = isNaN(m.r2) ? "-" : m.r2.toFixed(4);
            const rmseStr = isNaN(m.rmse) ? "-" : m.rmse.toExponential(2);
            const maeStr = isNaN(m.mae) ? "-" : m.mae.toExponential(2);

            tr.innerHTML = `
                <td>${m.name}</td>
                <td class="${ratingClass}">${ratingIcon}</td>
                <td>${r2Str}</td>
                <td>${rmseStr}</td>
                <td>${maeStr}</td>
                <td>${noteHtml}</td>
            `;
            tbody.appendChild(tr);
        });
        return;
    }

    compareTableContainer.style.display = "none";
    mainChartContainer.style.display = "block";

    const D_vals = validPoints.map(p => p.D);
    const tau_vals = validPoints.map(p => p.tau);
    const eta_vals = validPoints.map(p => p.eta);

    const D_min = Math.min(...D_vals);
    const D_max = Math.max(...D_vals);

    // フィッティング曲線のデータ生成用のX軸（D）分割
    const generateFitPoints = (fitFunc, isLog = false) => {
        const points = [];
        const steps = 150;
        if (isLog) {
            const logMin = Math.log10(Math.max(1e-5, D_min));
            const logMax = Math.log10(D_max);
            for (let i = 0; i <= steps; i++) {
                const logD = logMin + (logMax - logMin) * (i / steps);
                const D = Math.pow(10, logD);
                points.push({ x: D, y: fitFunc(D) });
            }
        } else {
            for (let i = 0; i <= steps; i++) {
                const D = D_min + (D_max - D_min) * (i / steps);
                points.push({ x: D, y: fitFunc(D) });
            }
        }
        return points;
    };

    const academicBoxPlugin = {
        id: 'academicBox',
        beforeDraw(chart) {
            const { ctx, chartArea } = chart;
            if (!chartArea) return;
            const { top, bottom, left, right } = chartArea;
            ctx.save();
            ctx.strokeStyle = 'rgba(226, 232, 240, 0.8)'; // 外枠の色
            ctx.lineWidth = 1.5;
            ctx.strokeRect(left, top, right - left, bottom - top);
            ctx.restore();
        }
    };

    let chartData = { datasets: [] };
    let chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: { color: '#f8fafc', font: { family: 'Inter, Noto Sans JP', size: 12 } }
            },
            tooltip: {
                callbacks: {
                    label: (context) => `${context.dataset.label}: (${context.parsed.x.toPrecision(4)}, ${context.parsed.y.toPrecision(4)})`
                }
            }
        },
        scales: {
            x: {
                title: { display: true, text: 'せん断速度 D [1/s]', color: '#e2e8f0', font: { size: 13, family: 'Inter, Noto Sans JP' } },
                grid: { 
                    color: 'rgba(255, 255, 255, 0.1)', // 罫線（薄め）
                    tickColor: 'rgba(226, 232, 240, 0.8)', // 目盛り線の色
                    tickLength: 6,
                    drawBorder: false // プラグインで枠を描くので不要
                },
                ticks: { 
                    color: '#cbd5e1',
                    font: { family: 'Inter' }
                }
            },
            y: {
                title: { display: true, text: 'せん断応力 τ [Pa]', color: '#e2e8f0', font: { size: 13, family: 'Inter, Noto Sans JP' } },
                grid: { 
                    color: 'rgba(255, 255, 255, 0.1)',
                    tickColor: 'rgba(226, 232, 240, 0.8)',
                    tickLength: 6,
                    drawBorder: false
                },
                ticks: { 
                    color: '#cbd5e1',
                    font: { family: 'Inter' }
                }
            }
        }
    };

    fittingPanel.style.display = "none";

    switch(state.activeTab) {
        case "flow": // 1. 流動曲線 (s vs D、プロットのみ)
            {
                chartData.datasets.push({
                    type: 'scatter',
                    label: `${activeSampleName} 測定データ`,
                    data: validPoints.map(p => ({ x: p.D, y: p.tau })),
                    backgroundColor: 'rgba(245, 158, 11, 0.8)',
                    borderColor: '#f59e0b',
                    pointRadius: 6
                });
            }
            break;

        case "viscosity": // 2. 粘性曲線 (η vs D, プロットのみ)
            {
                chartOptions.scales.x.type = 'logarithmic';
                chartOptions.scales.x.title.text = 'せん断速度 D [1/s] (対数スケール)';
                chartOptions.scales.y.type = 'logarithmic';
                chartOptions.scales.y.title.text = '粘度 η [Pa·s] (対数スケール)';

                // 対数変換可能な正のデータのみ
                const validLogPoints = validPoints.filter(p => p.D > 0 && p.eta > 0);

                chartData.datasets.push({
                    type: 'scatter',
                    label: `${activeSampleName} 測定データ`,
                    data: validLogPoints.map(p => ({ x: p.D, y: p.eta })),
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderColor: '#10b981',
                    pointRadius: 6
                });
            }
            break;

        case "newtonian": // Newtonianモデル (S = eta_0 * D)
            {
                const fitRes = solveNewtonian(D_vals, tau_vals);
                const eta_0 = fitRes.eta_0;
                const fitFunc = (x) => eta_0 * x;
                const fitPoints = generateFitPoints(fitFunc);

                chartData.datasets.push({
                    type: 'scatter',
                    label: `${activeSampleName} 測定データ`,
                    data: validPoints.map(p => ({ x: p.D, y: p.tau })),
                    backgroundColor: 'rgba(56, 189, 248, 0.8)',
                    borderColor: '#38bdf8',
                    pointRadius: 6
                });

                chartData.datasets.push({
                    type: 'line',
                    label: `Newtonian モデルフィット`,
                    data: fitPoints,
                    borderColor: 'rgba(56, 189, 248, 0.5)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false
                });

                fittingPanel.style.display = "flex";
                
                // LaTeX数式描画
                renderFormula(`\\begin{aligned}
\\tau &= \\eta_0 D \\\\
\\tau &= ${eta_0.toFixed(4)} D
\\end{aligned}`);

                fittingGrid.innerHTML = `
                    <div class="fitting-card">
                        <div class="fitting-card-title">粘度 η0 [Pa·s]</div>
                        <div class="fitting-card-value primary">${eta_0.toFixed(4)}</div>
                    </div>
                    <div class="fitting-card">
                        <div class="fitting-card-title">決定係数 R²</div>
                        <div class="fitting-card-value text-main">${fitRes.r2.toFixed(4)}</div>
                    </div>
                `;
            }
            break;

        case "bingham": // Binghamモデル (S = tau_y + eta_p * D)
            {
                const lr = linearRegression(D_vals, tau_vals);
                const fitFunc = (x) => lr.intercept + lr.slope * x;
                const fitPoints = generateFitPoints(fitFunc);

                chartData.datasets.push({
                    type: 'scatter',
                    label: `${activeSampleName} 測定データ`,
                    data: validPoints.map(p => ({ x: p.D, y: p.tau })),
                    backgroundColor: 'rgba(244, 63, 94, 0.8)',
                    borderColor: '#f43f5e',
                    pointRadius: 6
                });

                chartData.datasets.push({
                    type: 'line',
                    label: `Bingham モデルフィット`,
                    data: fitPoints,
                    borderColor: 'rgba(244, 63, 94, 0.5)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false
                });

                fittingPanel.style.display = "flex";
                
                // LaTeX数式描画
                const binghamInterceptStr = lr.intercept.toFixed(4);
                const binghamSlopeStr = lr.slope >= 0 ? `+ ${lr.slope.toFixed(4)}` : `- ${Math.abs(lr.slope).toFixed(4)}`;
                renderFormula(`\\begin{aligned}
\\tau &= \\tau_y + \\eta_p D \\\\
\\tau &= ${binghamInterceptStr} ${binghamSlopeStr} D
\\end{aligned}`);

                fittingGrid.innerHTML = `
                    <div class="fitting-card">
                        <div class="fitting-card-title">降伏値 τy [Pa]</div>
                        <div class="fitting-card-value red">${lr.intercept.toFixed(4)}</div>
                    </div>
                    <div class="fitting-card">
                        <div class="fitting-card-title">塑性粘度 ηp [Pa·s]</div>
                        <div class="fitting-card-value primary">${lr.slope.toFixed(4)}</div>
                    </div>
                    <div class="fitting-card">
                        <div class="fitting-card-title">決定係数 R²</div>
                        <div class="fitting-card-value text-main">${lr.r2.toFixed(4)}</div>
                    </div>
                `;
            }
            break;

        case "casson": // 4. Cassonモデル (√S = √tau_y + √eta_c * √D)
            {
                chartOptions.scales.x.title.text = '√(せん断速度 D [1/s])';
                chartOptions.scales.y.title.text = '√(せん断応力 τ [Pa])';

                const sqrtD = D_vals.map(x => Math.sqrt(x));
                const sqrtTau = tau_vals.map(y => Math.sqrt(y));

                const lr = linearRegression(sqrtD, sqrtTau);
                
                // 物理的解釈：傾き(√ηc)は正、切片(√τy)も正が望ましい。
                const tau_y = Math.pow(Math.max(0, lr.intercept), 2);
                const eta_c = Math.pow(Math.max(0, lr.slope), 2);

                const fitFunc = (x) => lr.intercept + lr.slope * x;

                // X軸は √D の範囲
                const sqrtD_min = Math.min(...sqrtD);
                const sqrtD_max = Math.max(...sqrtD);
                const fitPoints = [];
                const steps = 100;
                for (let i = 0; i <= steps; i++) {
                    const sd = sqrtD_min + (sqrtD_max - sqrtD_min) * (i / steps);
                    fitPoints.push({ x: sd, y: fitFunc(sd) });
                }

                chartData.datasets.push({
                    type: 'scatter',
                    label: `${activeSampleName} 測定データ`,
                    data: sqrtD.map((sd, i) => ({ x: sd, y: sqrtTau[i] })),
                    backgroundColor: 'rgba(168, 85, 247, 0.8)',
                    borderColor: '#a855f7',
                    pointRadius: 6
                });

                chartData.datasets.push({
                    type: 'line',
                    label: `Casson フィット`,
                    data: fitPoints,
                    borderColor: 'rgba(168, 85, 247, 0.5)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false
                });

                fittingPanel.style.display = "flex";
                
                // LaTeX数式描画
                const sqrtTauY = Math.max(0, lr.intercept).toFixed(4);
                const sqrtEtaC = Math.max(0, lr.slope).toFixed(4);
                renderFormula(`\\begin{aligned}
\\sqrt{\\tau} &= \\sqrt{\\tau_y} + \\sqrt{\\eta_c} \\sqrt{D} \\\\
\\sqrt{\\tau} &= ${sqrtTauY} + ${sqrtEtaC} \\sqrt{D}
\\end{aligned}`);

                fittingGrid.innerHTML = `
                    <div class="fitting-card">
                        <div class="fitting-card-title">Casson降伏値 τy [Pa]</div>
                        <div class="fitting-card-value red">${tau_y.toFixed(4)}</div>
                    </div>
                    <div class="fitting-card">
                        <div class="fitting-card-title">Casson粘度 ηc [Pa·s]</div>
                        <div class="fitting-card-value primary">${eta_c.toFixed(4)}</div>
                    </div>
                    <div class="fitting-card">
                        <div class="fitting-card-title">決定係数 R² (√軸上)</div>
                        <div class="fitting-card-value text-main">${lr.r2.toFixed(4)}</div>
                    </div>
                `;
            }
            break;

        case "powerlaw": // 5. Power-lawモデル (S = K * D^n)
            {
                // 両対数線形回帰: ln(S) = ln(K) + n*ln(D)
                // 有効な正データのみ
                const validPlPoints = validPoints.filter(p => p.D > 0 && p.tau > 0);
                
                if (validPlPoints.length < 2) {
                    fittingPanel.style.display = "flex";
                    fittingGrid.innerHTML = `<div class="text-cell text-muted">フィッティングに必要な正のデータが不足しています。</div>`;
                } else {
                    const lnD = validPlPoints.map(p => Math.log(p.D));
                    const lnTau = validPlPoints.map(p => Math.log(p.tau));

                    const lr = linearRegression(lnD, lnTau);
                    const n = lr.slope;
                    const K = Math.exp(lr.intercept);

                    const fitFunc = (x) => K * Math.pow(x, n);
                    const fitPoints = generateFitPoints(fitFunc);

                    chartData.datasets.push({
                        type: 'scatter',
                        label: `${activeSampleName} 測定データ`,
                        data: validPoints.map(p => ({ x: p.D, y: p.tau })),
                        backgroundColor: 'rgba(236, 72, 153, 0.8)',
                        borderColor: '#ec4899',
                        pointRadius: 6
                    });

                    chartData.datasets.push({
                        type: 'line',
                        label: `Power-law フィット`,
                        data: fitPoints,
                        borderColor: 'rgba(236, 72, 153, 0.5)',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        fill: false
                    });

                    fittingPanel.style.display = "flex";
                    
                    // LaTeX数式描画
                    renderFormula(`\\begin{aligned}
\\tau &= K D^n \\\\
\\tau &= ${K.toFixed(4)} D^{${n.toFixed(4)}}
\\end{aligned}`);

                    fittingGrid.innerHTML = `
                        <div class="fitting-card">
                            <div class="fitting-card-title">粘性係数 K [Pa·s^n]</div>
                            <div class="fitting-card-value primary">${K.toFixed(3)}</div>
                        </div>
                        <div class="fitting-card">
                            <div class="fitting-card-title">流動指数 n [-]</div>
                            <div class="fitting-card-value red">${n.toFixed(3)}</div>
                        </div>
                        <div class="fitting-card">
                            <div class="fitting-card-title">決定係数 R² (対数軸上)</div>
                            <div class="fitting-card-value text-main">${lr.r2.toFixed(4)}</div>
                        </div>
                    `;
                }
            }
            break;

        case "hb": // 6. Herschel-Bulkleyモデル (S = tau_y + K * D^n)
            {
                const hbFit = solveHerschelBulkley(D_vals, tau_vals);
                const fitFunc = (x) => hbFit.tau_y + hbFit.K * Math.pow(x, hbFit.n);
                const fitPoints = generateFitPoints(fitFunc);

                chartData.datasets.push({
                    type: 'scatter',
                    label: `${activeSampleName} 測定データ`,
                    data: validPoints.map(p => ({ x: p.D, y: p.tau })),
                    backgroundColor: 'rgba(59, 130, 246, 0.8)',
                    borderColor: '#3b82f6',
                    pointRadius: 6
                });

                chartData.datasets.push({
                    type: 'line',
                    label: `Herschel-Bulkley フィット`,
                    data: fitPoints,
                    borderColor: 'rgba(59, 130, 246, 0.5)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false
                });

                fittingPanel.style.display = "flex";
                
                // LaTeX数式描画
                const hbTauYStr = hbFit.tau_y.toFixed(4);
                const hbKStr = hbFit.K >= 0 ? `+ ${hbFit.K.toFixed(4)}` : `- ${Math.abs(hbFit.K).toFixed(4)}`;
                renderFormula(`\\begin{aligned}
\\tau &= \\tau_y + K D^n \\\\
\\tau &= ${hbTauYStr} ${hbKStr} D^{${hbFit.n.toFixed(4)}}
\\end{aligned}`);

                fittingGrid.innerHTML = `
                    <div class="fitting-card">
                        <div class="fitting-card-title">降伏値 τy [Pa]</div>
                        <div class="fitting-card-value red">${hbFit.tau_y.toFixed(4)}</div>
                    </div>
                    <div class="fitting-card">
                        <div class="fitting-card-title">粘性係数 K [Pa·s^n]</div>
                        <div class="fitting-card-value primary">${hbFit.K.toFixed(4)}</div>
                    </div>
                    <div class="fitting-card">
                        <div class="fitting-card-title">流動指数 n [-]</div>
                        <div class="fitting-card-value" style="color: var(--accent-orange); font-weight: 700; font-size: 1.1rem; font-family: 'Courier New', Courier, monospace;">${hbFit.n.toFixed(4)}</div>
                    </div>
                    <div class="fitting-card">
                        <div class="fitting-card-title">決定係数 R²</div>
                        <div class="fitting-card-value text-main">${hbFit.r2.toFixed(4)}</div>
                    </div>
                `;
            }
            break;

        case "cross":
            {
                chartOptions.scales.x.type = 'logarithmic';
                chartOptions.scales.x.title.text = 'せん断速度 D [1/s] (対数スケール)';
                chartOptions.scales.y.type = 'logarithmic';
                chartOptions.scales.y.title.text = '粘度 η [Pa·s] (対数スケール)';

                const validLogPoints = validPoints.filter(p => p.D > 0 && p.eta > 0);
                if (validLogPoints.length < 4) {
                    fittingPanel.style.display = "flex";
                    renderFormula(`\\text{フィッティング不能 (データ不足)}`);
                    fittingGrid.innerHTML = `<div class="text-cell text-muted">フィッティングに必要な正のデータが不足しています（最低4点必要）。</div>`;
                    break;
                }

                const logD_vals = validLogPoints.map(p => p.D);
                const logEta_vals = validLogPoints.map(p => p.eta);

                const fit = solveCrossModel(logD_vals, logEta_vals);
                
                const fitFunc = (x) => fit.eta_inf + (fit.eta_0 - fit.eta_inf) / (1 + Math.pow(fit.K * x, fit.m));
                const fitPoints = generateFitPoints(fitFunc, true);

                if (!isFinite(fit.eta_0) || !isFinite(fit.K)) {
                    fittingPanel.style.display = "flex";
                    renderFormula(`\\text{フィッティング不能 (収束エラー)}`);
                    fittingGrid.innerHTML = `<div class="text-cell text-muted">最適なパラメータが見つかりませんでした。入力データをご確認ください。</div>`;
                    break;
                }

                chartData.datasets.push({
                    type: 'scatter',
                    label: `${activeSampleName} 測定データ`,
                    data: validLogPoints.map(p => ({ x: p.D, y: p.eta })),
                    backgroundColor: 'rgba(139, 92, 246, 0.8)',
                    borderColor: '#8b5cf6',
                    pointRadius: 6
                });

                chartData.datasets.push({
                    type: 'line',
                    label: `Cross フィット`,
                    data: fitPoints,
                    borderColor: 'rgba(139, 92, 246, 0.5)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false
                });

                fittingPanel.style.display = "flex";
                renderFormula(`\\begin{aligned}
\\eta &= \\eta_\\infty + \\frac{\\eta_0 - \\eta_\\infty}{1 + (K \\dot{\\gamma})^m} \\\\
\\eta &= ${fit.eta_inf.toFixed(4)} + \\frac{${fit.eta_0.toFixed(4)} - ${fit.eta_inf.toFixed(4)}}{1 + (${fit.K.toFixed(4)} D)^{${fit.m.toFixed(4)}}}
\\end{aligned}`);
                
                fittingGrid.innerHTML = `
                    <div class="fitting-card">
                        <div class="fitting-card-title">ゼロせん断粘度 η0 [Pa·s]</div>
                        <div class="fitting-card-value red">${fit.eta_0.toFixed(4)}</div>
                    </div>
                    <div class="fitting-card">
                        <div class="fitting-card-title">無限せん断粘度 η∞ [Pa·s]</div>
                        <div class="fitting-card-value primary">${fit.eta_inf.toFixed(4)}</div>
                    </div>
                    <div class="fitting-card">
                        <div class="fitting-card-title">緩和時間 K [s]</div>
                        <div class="fitting-card-value" style="color: var(--accent-orange); font-weight: 700;">${fit.K.toFixed(4)}</div>
                    </div>
                    <div class="fitting-card">
                        <div class="fitting-card-title">指数 m [-]</div>
                        <div class="fitting-card-value" style="color: #10b981;">${fit.m.toFixed(4)}</div>
                    </div>
                    <div class="fitting-card" style="grid-column: span 2;">
                        <div class="fitting-card-title">決定係数 R²</div>
                        <div class="fitting-card-value text-main">${fit.r2.toFixed(4)}</div>
                    </div>
                `;
            }
            break;

        case "carreau":
            {
                chartOptions.scales.x.type = 'logarithmic';
                chartOptions.scales.x.title.text = 'せん断速度 D [1/s] (対数スケール)';
                chartOptions.scales.y.type = 'logarithmic';
                chartOptions.scales.y.title.text = '粘度 η [Pa·s] (対数スケール)';

                const validLogPoints = validPoints.filter(p => p.D > 0 && p.eta > 0);
                if (validLogPoints.length < 4) {
                    fittingPanel.style.display = "flex";
                    renderFormula(`\\text{フィッティング不能 (データ不足)}`);
                    fittingGrid.innerHTML = `<div class="text-cell text-muted">フィッティングに必要な正のデータが不足しています（最低4点必要）。</div>`;
                    break;
                }

                const logD_vals = validLogPoints.map(p => p.D);
                const logEta_vals = validLogPoints.map(p => p.eta);

                const fit = solveCarreauModel(logD_vals, logEta_vals);
                
                const fitFunc = (x) => fit.eta_inf + (fit.eta_0 - fit.eta_inf) * Math.pow(1 + Math.pow(fit.lambda * x, 2), (fit.n - 1) / 2);
                const fitPoints = generateFitPoints(fitFunc, true);

                if (!isFinite(fit.eta_0) || !isFinite(fit.lambda)) {
                    fittingPanel.style.display = "flex";
                    renderFormula(`\\text{フィッティング不能 (収束エラー)}`);
                    fittingGrid.innerHTML = `<div class="text-cell text-muted">最適なパラメータが見つかりませんでした。入力データをご確認ください。</div>`;
                    break;
                }

                chartData.datasets.push({
                    type: 'scatter',
                    label: `${activeSampleName} 測定データ`,
                    data: validLogPoints.map(p => ({ x: p.D, y: p.eta })),
                    backgroundColor: 'rgba(236, 72, 153, 0.8)',
                    borderColor: '#ec4899',
                    pointRadius: 6
                });

                chartData.datasets.push({
                    type: 'line',
                    label: `Carreau フィット`,
                    data: fitPoints,
                    borderColor: 'rgba(236, 72, 153, 0.5)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false
                });

                fittingPanel.style.display = "flex";
                renderFormula(`\\begin{aligned}
\\eta &= \\eta_\\infty + (\\eta_0 - \\eta_\\infty)[1 + (\\lambda \\dot{\\gamma})^2]^{(n-1)/2} \\\\
\\eta &= ${fit.eta_inf.toFixed(4)} + (${fit.eta_0.toFixed(4)} - ${fit.eta_inf.toFixed(4)})[1 + (${fit.lambda.toFixed(4)} D)^2]^{(${fit.n.toFixed(4)}-1)/2}
\\end{aligned}`);
                
                fittingGrid.innerHTML = `
                    <div class="fitting-card">
                        <div class="fitting-card-title">ゼロせん断粘度 η0 [Pa·s]</div>
                        <div class="fitting-card-value red">${fit.eta_0.toFixed(4)}</div>
                    </div>
                    <div class="fitting-card">
                        <div class="fitting-card-title">無限せん断粘度 η∞ [Pa·s]</div>
                        <div class="fitting-card-value primary">${fit.eta_inf.toFixed(4)}</div>
                    </div>
                    <div class="fitting-card">
                        <div class="fitting-card-title">緩和時間 λ [s]</div>
                        <div class="fitting-card-value" style="color: var(--accent-orange); font-weight: 700;">${fit.lambda.toFixed(4)}</div>
                    </div>
                    <div class="fitting-card">
                        <div class="fitting-card-title">指数 n [-]</div>
                        <div class="fitting-card-value" style="color: #10b981;">${fit.n.toFixed(4)}</div>
                    </div>
                    <div class="fitting-card" style="grid-column: span 2;">
                        <div class="fitting-card-title">決定係数 R²</div>
                        <div class="fitting-card-value text-main">${fit.r2.toFixed(4)}</div>
                    </div>
                `;
            }
            break;
    }

    chartInstance = new Chart(canvas, {
        data: chartData,
        options: chartOptions,
        plugins: [academicBoxPlugin]
    });
}

// ==========================================
// 6. CSVインポート/エクスポート機能
// ==========================================

// CSVファイルのエクスポート
function saveCSV() {
    let csvContent = "\uFEFF"; // Excelで文字化けしないためのBOM
    
    // 仕様メタデータの出力
    csvContent += `#Maker,${state.specs.maker || ""}\n`;
    csvContent += `#Meter type,${state.specs.meterType || ""}\n`;
    csvContent += `#Rotor type,${state.specs.rotorType || ""}\n`;
    csvContent += `#Range type,${state.specs.rangeType || ""}\n`;
    csvContent += `#Torque(dyn·cm),${state.specs.torqueDyn !== null ? state.specs.torqueDyn : ""}\n`;
    csvContent += `#Torque(N·m),${state.specs.torqueNm !== null ? state.specs.torqueNm : ""}\n`;
    
    // ヘッダー行
    csvContent += "データ入力," + state.sampleNames.join(",") + "\n";
    
    // サンプルラベル行
    csvContent += "RPM," + state.sampleNames.join(",") + "\n";

    // データ行
    state.rpms.forEach((rpm, rpmIdx) => {
        let row = [rpm];
        state.sampleNames.forEach((_, sampleIdx) => {
            const val = state.inputData[sampleIdx][rpmIdx];
            row.push(val !== null ? val : "");
        });
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `viscometer_input_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// CSVファイルのインポート
function loadCSV(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        const text = evt.target.result;
        // 改行コードでスプリットしてパース
        const rows = text.split(/\r?\n/).map(row => row.split(","));
        
        if (rows.length < 3) {
            alert("エラー: 有効なCSVフォーマットではありません。");
            return;
        }

        let dataStartRowIdx = 0;
        
        // メタデータ (# で始まる行) の読み込み
        while (dataStartRowIdx < rows.length && rows[dataStartRowIdx][0] && rows[dataStartRowIdx][0].startsWith("#")) {
            const key = rows[dataStartRowIdx][0].substring(1).trim();
            const val = rows[dataStartRowIdx][1] ? rows[dataStartRowIdx][1].trim() : "";
            
            if (key === "Maker") state.specs.maker = val;
            else if (key === "Meter type") state.specs.meterType = val;
            else if (key === "Rotor type") state.specs.rotorType = val;
            else if (key === "Range type") state.specs.rangeType = val;
            else if (key === "Torque(dyn·cm)") state.specs.torqueDyn = val !== "" ? parseFloat(val) : null;
            else if (key === "Torque(N·m)") state.specs.torqueNm = val !== "" ? parseFloat(val) : null;
            
            dataStartRowIdx++;
        }

        // 基本仕様 UI を更新
        if (dataStartRowIdx > 0) {
            updateSpecsUI();
        }

        // 列数の決定 (ヘッダー行のカンマ数)
        const sampleHeader = rows[dataStartRowIdx];
        if (!sampleHeader) {
            alert("エラー: データが見つかりません。");
            return;
        }
        
        const numCols = sampleHeader.length;
        if (numCols < 2) {
            alert("エラー: 列数が不足しています。");
            return;
        }

        const newSampleNames = [];
        const newInputData = [];
        
        // サンプル名抽出 (データ入力セルの後ろ)
        for (let j = 1; j < numCols; j++) {
            if (sampleHeader[j] !== undefined && sampleHeader[j].trim() !== "") {
                newSampleNames.push(sampleHeader[j].trim());
            } else {
                newSampleNames.push(`Sample #${j}`);
            }
            newInputData.push(new Array(state.rpms.length).fill(null));
        }

        // RPM行のパース (インデックス2行目から読み取り開始)
        // CSVの1行目: サンプルヘッダ、2行目: "RPM, Sample1, Sample2..." (ラベル)
        // 3行目以降: データ
        let dataRowIdxStart = 2;
        
        // 念のため、2行目が "RPM" か確認。異なれば1行目からやり直すなどの柔軟性を
        if (rows[1][0] !== "RPM") {
            dataRowIdxStart = 1;
        }

        for (let i = dataRowIdxStart; i < rows.length; i++) {
            const rowData = rows[i];
            if (!rowData || rowData.length === 0 || rowData[0] === "") continue;
            
            const rpmVal = parseFloat(rowData[0]);
            // 対応するRPMインデックスを見つける
            const rpmIdx = state.rpms.indexOf(rpmVal);
            if (rpmIdx !== -1) {
                newSampleNames.forEach((_, sampleIdx) => {
                    const csvColIdx = sampleIdx + 1;
                    if (rowData[csvColIdx] !== undefined && rowData[csvColIdx].trim() !== "") {
                        const cellVal = parseFloat(rowData[csvColIdx]);
                        newInputData[sampleIdx][rpmIdx] = isNaN(cellVal) ? null : cellVal;
                    }
                });
            }
        }

        // アプリ状態の更新
        state.numSamples = newSampleNames.length;
        state.sampleNames = newSampleNames;
        state.inputData = newInputData;
        state.activeSampleIndex = 0;

        saveToLocalStorage();
        renderInputTable();
        renderSampleTabs();
        calculate();
        
        document.getElementById("csv-file-input").value = ""; // リセット
        updateStatus("CSVデータを読み込みました");
    };
    reader.readAsText(file);
}



// ステータス表示の更新
function updateStatus(text) {
    const statusText = document.getElementById("status-text");
    statusText.innerText = text;
}

// ==========================================
// 8. localStorage 連携
// ==========================================

function saveToLocalStorage() {
    const savedState = {
        rpms: state.rpms,
        coneType: state.coneType,
        numSamples: state.numSamples,
        sampleNames: state.sampleNames,
        inputData: state.inputData,
        activeSampleIndex: state.activeSampleIndex,
        activeTab: state.activeTab,
        specs: state.specs
    };
    localStorage.setItem("viscometer_state", JSON.stringify(savedState));
}

function loadFromLocalStorage() {
    // 状態の復元
    const storedState = localStorage.getItem("viscometer_state");
    if (storedState) {
        try {
            const parsed = JSON.parse(storedState);
            
            // rpms の復元を先に行う
            if (parsed.rpms && Array.isArray(parsed.rpms)) {
                state.rpms = parsed.rpms;
            }
            
            // データの整合性を厳密にチェック
            const isValid = parsed && 
                            Array.isArray(parsed.sampleNames) && 
                            Array.isArray(parsed.inputData) && 
                            parsed.sampleNames.length === parsed.inputData.length &&
                            parsed.inputData.every(row => Array.isArray(row) && row.length === state.rpms.length);
            
            if (isValid) {
                state.coneType = parsed.coneType || "Cone(small)";
                state.numSamples = parsed.numSamples || parsed.sampleNames.length;
                state.sampleNames = parsed.sampleNames;
                state.inputData = parsed.inputData;
                state.activeSampleIndex = parsed.activeSampleIndex || 0;
                state.activeTab = parsed.activeTab || "flow";
                if (parsed.specs) {
                    state.specs = parsed.specs;
                }
            } else {
                console.warn("localStorageのデータ構造が無効なため、初期化してデフォルト値を適用します。");
                localStorage.removeItem("viscometer_state");
            }

            // グラフタブの選択状態を更新
            document.querySelectorAll(".tab-btn").forEach(btn => {
                btn.classList.toggle("active", btn.dataset.tab === state.activeTab);
            });
        } catch (e) {
            console.error("localStorageからの状態復元に失敗しました。", e);
            localStorage.removeItem("viscometer_state");
        }
    }

    // カスタムパラメータの復元
    const storedParams = localStorage.getItem("viscometer_custom_params");
    if (storedParams) {
        try {
            const parsedParams = JSON.parse(storedParams);
            if (parsedParams && parsedParams["Cone(small)"] && parsedParams["Cone(large)"]) {
                coneParams = parsedParams;
                updateStatus("保存されたカスタムパラメータを適用中");
            } else {
                localStorage.removeItem("viscometer_custom_params");
            }
        } catch (e) {
            console.error("localStorageからのカスタムパラメータ復元に失敗しました。", e);
            localStorage.removeItem("viscometer_custom_params");
        }
    }
}

// テスト用サンプルデータの読み込み
function loadSampleData() {
    state.numSamples = 4;
    state.sampleNames = ["チーズ", "クリーム", "バター", "とろろ"];
    const rawData = [
        [100, 50, 10, 2], // チーズ
        [56, 20, 2], // クリーム
        [34, 11], // バター
        [46, 24, 11] // とろろ
    ];
    
    state.inputData = rawData.map(d => {
        const row = new Array(state.rpms.length).fill(null);
        d.forEach((val, i) => {
            if (i < state.rpms.length) row[i] = val;
        });
        return row;
    });
    state.activeSampleIndex = 0;
    saveToLocalStorage();
    renderInputTable();
    renderSampleTabs();
    calculate();
    updateStatus("サンプルデータをロードしました (デモデータ適用中)");
}

// ==========================================
// 9. 新規コーンパラメータ追加モーダル & ドロップダウン制御
// ==========================================

// ドロップダウンリストを coneParams のキーに合わせて動的更新
function updateConeDropdown() {
    const selectEl = document.getElementById("cone-select");
    if (!selectEl) return;
    
    // 既存の動的オプション（Small, Large, 新規追加 以外）をクリア
    const keepValues = ["Cone(small)", "Cone(large)", "create_new"];
    Array.from(selectEl.options).forEach(opt => {
        if (!keepValues.includes(opt.value)) {
            selectEl.removeChild(opt);
        }
    });
    
    // カスタムコーンのオプションをドロップダウンに動的に追加
    Object.keys(coneParams).forEach(key => {
        if (key !== "Cone(small)" && key !== "Cone(large)") {
            const opt = document.createElement("option");
            opt.value = key;
            opt.innerText = key;
            // 「新規追加...」の直前に挿入
            const createNewOpt = selectEl.querySelector('option[value="create_new"]');
            selectEl.insertBefore(opt, createNewOpt);
        }
    });
}

// モーダルダイアログの表示
function showConeModal() {
    const modal = document.getElementById("cone-modal");
    if (!modal) return;
    
    // コーン名称の初期化
    document.getElementById("new-cone-name").value = "";
    
    // 物理仕様のデフォルト値として Small コーンをセット
    document.getElementById("new-cone-radius").value = "1.2";
    document.getElementById("new-cone-angle").value = "1.565";
    
    // 8行分の入力欄を動的生成
    const body = document.getElementById("modal-params-body");
    body.innerHTML = "";
    
    const template = coneParams["Cone(small)"];
    
    state.rpms.forEach((rpm, idx) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td class="font-bold">${rpm}</td>
            <td><input type="number" step="any" class="cell-input modal-kn" value="${template.KN[idx]}" required></td>
            <td><input type="number" step="any" class="cell-input modal-k0" value="${template.K0[idx]}" required></td>
            <td><input type="number" step="any" class="cell-input modal-k1" value="${template.K1[idx]}" required></td>
            <td><input type="number" step="any" class="cell-input modal-k2" value="${template.K2[idx]}" required></td>
        `;
        body.appendChild(tr);
    });
    
    // 自動計算を実行してテーブルセルの値を最新に
    recalculateConeConstants();
    
    modal.style.display = "flex";
    document.body.style.overflow = "hidden"; // 背面のスクロールを禁止
    
    // アイコンの再描画
    if (typeof lucide !== "undefined") {
        lucide.createIcons();
    }
}

// モーダルダイアログの非表示
function hideConeModal() {
    const modal = document.getElementById("cone-modal");
    if (modal) {
        modal.style.display = "none";
        document.body.style.overflow = "";
    }
}

// テンプレート (Small / Large) の適用
function applyTemplate(type) {
    const radiusEl = document.getElementById("new-cone-radius");
    const angleEl = document.getElementById("new-cone-angle");
    
    if (type === "Cone(small)") {
        if (radiusEl) radiusEl.value = "1.2";
        if (angleEl) angleEl.value = "1.565";
    } else if (type === "Cone(large)") {
        if (radiusEl) radiusEl.value = "2.4";
        if (angleEl) angleEl.value = "1.565";
    }
    
    // 手動入力テーブルにテンプレートの静的配列をロード
    const template = coneParams[type];
    if (!template) return;
    
    const knInputs = document.querySelectorAll(".modal-kn");
    const k0Inputs = document.querySelectorAll(".modal-k0");
    const k1Inputs = document.querySelectorAll(".modal-k1");
    const k2Inputs = document.querySelectorAll(".modal-k2");
    
    state.rpms.forEach((_, idx) => {
        if (knInputs[idx]) knInputs[idx].value = template.KN[idx];
        if (k0Inputs[idx]) k0Inputs[idx].value = template.K0[idx];
        if (k1Inputs[idx]) k1Inputs[idx].value = template.K1[idx];
        if (k2Inputs[idx]) k2Inputs[idx].value = template.K2[idx];
    });
}

// 新規コーンパラメータの保存
function saveNewCone() {
    const nameInput = document.getElementById("new-cone-name");
    const name = nameInput.value.trim();
    
    if (!name) {
        alert("コーンの名称を入力してください。");
        nameInput.focus();
        return;
    }
    
    if (name === "Cone(small)" || name === "Cone(large)" || name === "create_new") {
        alert("その名称はシステム予約語のため使用できません。別の名称を入力してください。");
        nameInput.focus();
        return;
    }
    
    const KN = [], K0 = [], K1 = [], K2 = [];
    const knInputs = document.querySelectorAll(".modal-kn");
    const k0Inputs = document.querySelectorAll(".modal-k0");
    const k1Inputs = document.querySelectorAll(".modal-k1");
    const k2Inputs = document.querySelectorAll(".modal-k2");
    
    let valid = true;
    for (let i = 0; i < state.rpms.length; i++) {
        const knVal = parseFloat(knInputs[i].value);
        const k0Val = parseFloat(k0Inputs[i].value);
        const k1Val = parseFloat(k1Inputs[i].value);
        const k2Val = parseFloat(k2Inputs[i].value);
        
        if (isNaN(knVal) || isNaN(k0Val) || isNaN(k1Val) || isNaN(k2Val)) {
            valid = false;
            break;
        }
        
        KN.push(knVal);
        K0.push(k0Val);
        K1.push(k1Val);
        K2.push(k2Val);
    }
    
    if (!valid) {
        alert("すべてのパラメータ行に有効な数値を入力してください。");
        return;
    }
    
    // メモリ上のパラメータオブジェクトへ追加
    coneParams[name] = { KN, K0, K1, K2 };
    
    // カスタムパラメータをローカルストレージへ永続化
    localStorage.setItem("viscometer_custom_params", JSON.stringify(coneParams));
    
    // UI側のドロップダウンを更新して新規追加したコーンを選択
    updateConeDropdown();
    state.coneType = name;
    
    const selectEl = document.getElementById("cone-select");
    if (selectEl) selectEl.value = name;
    
    saveToLocalStorage();
    calculate();
    hideConeModal();
    updateStatus(`新規コーン「${name}」を登録し、パラメータを適用しました。`);
}

// 粘度計仕様テーブルUIに state.specs を反映する
function updateSpecsUI() {
    const makerEl = document.getElementById("spec-maker");
    const meterTypeEl = document.getElementById("spec-meter-type");
    const rotorTypeEl = document.getElementById("spec-rotor-type");
    const rangeTypeEl = document.getElementById("spec-range-type");
    const rpmSetEl = document.getElementById("spec-rpm-set");
    const torqueDynEl = document.getElementById("spec-torque-dyn");
    const torqueNmEl = document.getElementById("spec-torque-nm");
    
    if (makerEl) makerEl.value = state.specs.maker || "";
    if (meterTypeEl) meterTypeEl.value = state.specs.meterType || "";
    if (rotorTypeEl) rotorTypeEl.value = state.specs.rotorType || "";
    if (rangeTypeEl) rangeTypeEl.value = state.specs.rangeType || "";
    if (rpmSetEl) rpmSetEl.value = state.rpms.join(", ");
    if (torqueNmEl) torqueNmEl.value = state.specs.torqueNm !== null ? state.specs.torqueNm : "";
    if (torqueDynEl) torqueDynEl.value = state.specs.torqueDyn !== null ? state.specs.torqueDyn : "";
    
    updateCalculatedSpringK();
}

// フルスケールトルクからばね定数 k を計算・UI更新する
function updateCalculatedSpringK() {
    const kDynEl = document.getElementById("spec-spring-k-dyn");
    const kNmEl = document.getElementById("spec-spring-k-nm");
    
    if (state.specs.torqueDyn !== null && !isNaN(state.specs.torqueDyn) && state.specs.torqueDyn > 0) {
        // ばね定数 k = フルスケールトルク * (11840 / 7187)
        const k_dyn = state.specs.torqueDyn * (11840 / 7187);
        const k_nm = k_dyn * 1e-7;
        
        if (kDynEl) kDynEl.value = Math.round(k_dyn); 
        if (kNmEl) kNmEl.value = k_nm.toFixed(9); 
    } else {
        if (kDynEl) kDynEl.value = "";
        if (kNmEl) kNmEl.value = "";
    }
    
    // コーンパラメータ計算に影響するため再計算をトリガー
    recalculateConeConstants();
}

// コーン物理仕様から8つのRPMの定数を自動計算する
function recalculateConeConstants() {
    const radiusEl = document.getElementById("new-cone-radius");
    const angleEl = document.getElementById("new-cone-angle");
    
    if (!radiusEl || !angleEl) return;
    
    const R = parseFloat(radiusEl.value);
    const theta = parseFloat(angleEl.value);
    
    // ばね定数kは粘度計のフルスケールトルクから取得
    let k_dyn = 0;
    if (state.specs.torqueDyn !== null && !isNaN(state.specs.torqueDyn) && state.specs.torqueDyn > 0) {
        k_dyn = state.specs.torqueDyn * (11840 / 7187);
    }
    
    // いずれかが無効な数値の場合は何もしない (手動入力を活かすため)
    if (isNaN(R) || isNaN(theta) || isNaN(k_dyn) || R <= 0 || theta <= 0 || k_dyn <= 0) {
        return;
    }
    
    // 物理定数の計算
    const theta_rad = theta * Math.PI / 180;
    const K2 = (2 * Math.PI) / (60 * Math.sin(theta_rad));
    const K1 = (3 * k_dyn) / (2000 * Math.PI * Math.pow(R, 3));
    const K0 = K1 / K2;
    
    const knInputs = document.querySelectorAll(".modal-kn");
    const k0Inputs = document.querySelectorAll(".modal-k0");
    const k1Inputs = document.querySelectorAll(".modal-k1");
    const k2Inputs = document.querySelectorAll(".modal-k2");
    
    state.rpms.forEach((rpm, idx) => {
        const KN = K0 * 60000 / rpm;
        
        if (knInputs[idx]) knInputs[idx].value = KN.toFixed(4);
        if (k0Inputs[idx]) k0Inputs[idx].value = K0.toFixed(6);
        if (k1Inputs[idx]) k1Inputs[idx].value = K1.toFixed(6);
        if (k2Inputs[idx]) k2Inputs[idx].value = K2.toFixed(6);
    });
}

// RPMセットが変更された際、すべての登録済みコーンの定数配列を再計算・リサイズする
function recalcAllConeParamsForNewRpms() {
    Object.keys(coneParams).forEach(coneName => {
        const params = coneParams[coneName];
        
        // 既存の配列から代表値（インデックス0）を取得
        const k0_val = (params.K0 && params.K0.length > 0) ? params.K0[0] : 0;
        const k1_val = (params.K1 && params.K1.length > 0) ? params.K1[0] : 0;
        const k2_val = (params.K2 && params.K2.length > 0) ? params.K2[0] : 0;
        
        const newKN = [];
        const newK0 = [];
        const newK1 = [];
        const newK2 = [];
        
        state.rpms.forEach(rpm => {
            newKN.push(k0_val * 60000 / rpm);
            newK0.push(k0_val);
            newK1.push(k1_val);
            newK2.push(k2_val);


        });
        
        coneParams[coneName] = {
            KN: newKN,
            K0: newK0,
            K1: newK1,
            K2: newK2
        };
    });
}

// ==========================================
// 10. 基本仕様のインポート/エクスポート/初期化機能
// ==========================================

function loadDefaultSpecs() {
    if (confirm("基本仕様をデフォルト値に戻しますか？\n※入力したデータは保持されますが、RPMの設定によって行数が変わる場合があります。")) {
        state.specs = {
            maker: "Blockfiled (販売代理店：東機産業)",
            meterType: "RV (EH-type)",
            rotorType: "E-type (Cone-Plate type)",
            rangeType: "H type",
            torqueDyn: 7187,
            torqueNm: 0.0007187
        };
        state.rpms = [...defaultRPMs];
        
        updateSpecsUI();
        recalcAllConeParamsForNewRpms();
        
        const newLen = state.rpms.length;
        state.inputData = state.inputData.map(d => {
            const row = new Array(newLen).fill(null);
            d.forEach((val, i) => { if (i < newLen) row[i] = val; });
            return row;
        });
        
        saveToLocalStorage();
        renderInputTable();
        calculate();
        updateStatus("デフォルトの基本仕様をロードしました。");
    }
}

function saveSpecsCSV() {
    let csvContent = "\uFEFF";
    csvContent += "Key,Value\n";
    csvContent += `Maker,"${state.specs.maker || ""}"\n`;
    csvContent += `Meter type,"${state.specs.meterType || ""}"\n`;
    csvContent += `Rotor type,"${state.specs.rotorType || ""}"\n`;
    csvContent += `Range type,"${state.specs.rangeType || ""}"\n`;
    csvContent += `Torque(dyn·cm),${state.specs.torqueDyn !== null ? state.specs.torqueDyn : ""}\n`;
    csvContent += `Torque(N·m),${state.specs.torqueNm !== null ? state.specs.torqueNm : ""}\n`;
    csvContent += `RPMs,"${state.rpms.join(", ")}"\n`;
    
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `viscometer_specs_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function loadSpecsCSV(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        const text = evt.target.result;
        let rows = [];
        let row = [];
        let inQuotes = false;
        let val = "";
        for (let i = 0; i < text.length; i++) {
            let c = text[i];
            if (c === '"') {
                inQuotes = !inQuotes;
            } else if (c === ',' && !inQuotes) {
                row.push(val);
                val = "";
            } else if (c === '\n' && !inQuotes) {
                row.push(val);
                rows.push(row);
                row = [];
                val = "";
            } else if (c !== '\r') {
                val += c;
            }
        }
        if (val || row.length > 0) {
            row.push(val);
            rows.push(row);
        }
        
        let valid = false;
        rows.forEach(r => {
            if (r.length >= 2) {
                const key = r[0].trim();
                const v = r[1].trim();
                if (key === "Maker") { state.specs.maker = v; valid = true; }
                else if (key === "Meter type") state.specs.meterType = v;
                else if (key === "Rotor type") state.specs.rotorType = v;
                else if (key === "Range type") state.specs.rangeType = v;
                else if (key === "Torque(dyn·cm)") state.specs.torqueDyn = v !== "" ? parseFloat(v) : null;
                else if (key === "Torque(N·m)") state.specs.torqueNm = v !== "" ? parseFloat(v) : null;
                else if (key === "RPMs") {
                    const parsed = v.split(",").map(vStr => parseFloat(vStr.trim())).filter(vFloat => !isNaN(vFloat));
                    if (parsed.length > 0) {
                        state.rpms = parsed;
                    }
                }
            }
        });
        
        if (valid) {
            updateSpecsUI();
            recalcAllConeParamsForNewRpms();
            
            const newLen = state.rpms.length;
            state.inputData = state.inputData.map(d => {
                const newRow = new Array(newLen).fill(null);
                d.forEach((v, i) => { if (i < newLen) newRow[i] = v; });
                return newRow;
            });
            
            saveToLocalStorage();
            renderInputTable();
            calculate();
            updateStatus("基本仕様をCSVから読み込みました。");
        } else {
            alert("エラー: 有効な仕様CSVフォーマットではありません。");
        }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset
}

// ==========================================
// 8. 理論・計算式モーダル処理
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    const theoryBtn = document.getElementById("theory-btn");
    const theoryModal = document.getElementById("theory-modal");
    const theoryCloseBtn = document.getElementById("theory-modal-close-btn");
    const theoryOkBtn = document.getElementById("theory-modal-ok-btn");

    if (theoryBtn && theoryModal) {
        theoryBtn.addEventListener("click", () => {
            theoryModal.style.display = "flex";
            renderTheoryMath();
        });

        const closeTheoryModal = () => { theoryModal.style.display = "none"; };
        theoryCloseBtn.addEventListener("click", closeTheoryModal);
        theoryOkBtn.addEventListener("click", closeTheoryModal);
        theoryModal.addEventListener("click", (e) => {
            if (e.target === theoryModal) closeTheoryModal();
        });
    }
});

function renderTheoryMath() {
    if (typeof katex === "undefined") return;

    const mathBlocks = [
        { id: "theory-math-newtonian", tex: "\\text{Newtonian:} \\quad \\tau = \\eta_0 D \\quad (\\eta = \\eta_0)" },
        { id: "theory-math-1", tex: "D = \\frac{\\pi N}{30 \\alpha}" },
        { id: "theory-math-2", tex: "\\tau = \\frac{3 T_{full}}{2 \\pi R^3} \\times \\frac{TI}{100}" },
        { id: "theory-math-3", tex: "\\eta = \\frac{\\tau}{D}" },
        { id: "theory-math-4", tex: "\\text{Bingham:} \\quad \\tau = \\tau_y + \\eta_p D" },
        { id: "theory-math-5", tex: "\\text{Casson:} \\quad \\sqrt{\\tau} = \\sqrt{\\tau_y} + \\sqrt{\\eta_c} \\sqrt{D}" },
        { id: "theory-math-6", tex: "\\text{Herschel-Bulkley:} \\quad \\tau = \\tau_y + K D^n" },
        { id: "theory-math-7", tex: "\\text{Power-law:} \\quad \\tau = K D^n \\quad (\\eta = K D^{n-1})" },
        { id: "theory-math-8", tex: "\\text{Cross:} \\quad \\eta = \\eta_\\infty + \\frac{\\eta_0 - \\eta_\\infty}{1 + (K D)^m}" },
        { id: "theory-math-9", tex: "\\text{Carreau:} \\quad \\eta = \\eta_\\infty + (\\eta_0 - \\eta_\\infty) [1 + (\\lambda D)^2]^{\\frac{n-1}{2}}" },
        { id: "theory-math-10", tex: "\\begin{aligned} \\text{RMSE} &= \\sqrt{ \\frac{1}{n} \\sum_{i=1}^n (\\tau_{\\text{obs},i} - \\tau_{\\text{pred},i})^2 } \\\\ \\text{MAE} &= \\frac{1}{n} \\sum_{i=1}^n |\\tau_{\\text{obs},i} - \\tau_{\\text{pred},i}| \\end{aligned}" },
        { id: "theory-math-11", tex: "R^2 = 1 - \\frac{\\sum (y_i - \\hat{y}_i)^2}{\\sum (y_i - \\bar{y})^2}" },
        { id: "theory-math-12", tex: "\\begin{aligned} y &= ax + b \\\\ a &= \\frac{\\sum (x_i - \\bar{x})(y_i - \\bar{y})}{\\sum (x_i - \\bar{x})^2} \\\\ b &= \\bar{y} - a\\bar{x} \\end{aligned}" },
        { id: "theory-math-13", tex: "\\min_{\\theta} \\sum_{i=1}^n (\\tau_{\\text{obs},i} - \\tau_{\\text{pred},i}(\\theta))^2" }
    ];

    mathBlocks.forEach(block => {
        const el = document.getElementById(block.id);
        if (el && !el.hasAttribute("data-rendered")) {
            try {
                katex.render(block.tex, el, { displayMode: true, throwOnError: false });
                el.setAttribute("data-rendered", "true");
            } catch (err) {
                console.error("KaTeX render error", err);
            }
        }
    });

    document.querySelectorAll('.inline-math').forEach(el => {
        if (!el.hasAttribute("data-rendered")) {
            try {
                // Remove any backslashes used to escape characters in standard text content, or just render directly
                const tex = el.textContent;
                katex.render(tex, el, { displayMode: false, throwOnError: false });
                el.setAttribute("data-rendered", "true");
            } catch (err) {
                console.error("KaTeX inline render error", err);
            }
        }
    });
}

