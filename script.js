// script.js - 核心邏輯 (讀取 Google 試算表數據)

// =======================================================
// ⚠️ 請在貼上程式碼前，修改以下兩個變數：
// =======================================================
const SPREADSHEET_ID = '1QwVIsVUMRg0IJkSR4iQnHCvskqlYRxhqyyC2cBWKLX4'; // <-- 替換成您試算表的 ID
const SHEET_NAMES = [
    'COUNTRIES', // 國家列表
    'RISKS',     // 風險分類表
    'RULES',     // 規則主體
    'STEPS',     // 具體步驟
    'REQS'       // 法規要求
];
// =======================================================

// 全局變數：儲存從 Google Sheets 載入的數據
let PET_REGULATIONS = {};

// Google Sheets API URL 基礎結構
const SHEET_BASE_URL = (sheetName) =>
    `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?sheet=${sheetName}&tqx=out:json`;


// ------------------------------------------
// I. 數據獲取與初始化
// ------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    const searchButton = document.getElementById('search-button');
    const countryFromInput = document.getElementById('country-from-input');
    const countryToInput = document.getElementById('country-to-input');

    // 禁用按鈕直到數據載入
    searchButton.disabled = true;
    countryFromInput.placeholder = '載入數據中...';
    countryToInput.placeholder = '載入數據中...';

    // 載入並處理數據
    loadDataFromSheets()
        .then(() => {
            // 數據載入成功後，初始化前端功能
            setupFrontend();
            console.log("數據載入成功！PET_REGULATIONS 物件已更新。");
        })
        .catch(error => {
            console.error("數據載入失敗:", error);
            alert("錯誤：無法從 Google 試算表載入數據。請檢查網路連線、試算表 ID 和工作表名稱。");
            countryFromInput.placeholder = '載入失敗';
            countryToInput.placeholder = '載入失敗';
        });
});

/**
 * 負責從 Google Sheets 逐一獲取並重組數據
 */
async function loadDataFromSheets() {
    let rawData = {};
    
    // 1. 逐一獲取所有工作表的數據
    for (const sheetName of SHEET_NAMES) {
        const url = SHEET_BASE_URL(sheetName);
        const response = await fetch(url);
        const text = await response.text();
        
        // Google Sheets Gviz API 返回的 JSON 格式特殊，需要手動清理
        const jsonText = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
        const data = JSON.parse(jsonText);
        
        // 將數據轉換為可用的物件陣列
        const rows = data.table.rows.map(row => {
            let rowObj = {};
            row.c.forEach((cell, index) => {
                const header = data.table.cols[index].label;
                rowObj[header] = cell ? (cell.v || cell.f) : '';
            });
            return rowObj;
        });
        rawData[sheetName] = rows;
    }

    // 2. 數據重組：從扁平表格結構轉換為巢狀 PET_REGULATIONS 物件
    PET_REGULATIONS = transformData(rawData);
}

/**
 * 將扁平的試算表數據轉換為程式所需的巢狀結構
 */
function transformData(data) {
    const newRegs = {};

    // A. 處理 COUNTRIES (國家列表)
    newRegs.COUNTRIES = {};
    data.COUNTRIES.forEach(c => {
        newRegs.COUNTRIES[c.Code] = c.Name_TW + ' (' + c.Name_EN + ')';
        // 初始化每個目的地國家
        if (!newRegs[c.Code]) newRegs[c.Code] = { rules_by_risk: {} };
    });

    // B. 處理 RISKS (風險分類表)
    newRegs.RISK_CLASSIFICATION = {};
    data.RISKS.forEach(r => {
        if (!newRegs.RISK_CLASSIFICATION[r.Dest_Code]) {
            newRegs.RISK_CLASSIFICATION[r.Dest_Code] = {};
        }
        newRegs.RISK_CLASSIFICATION[r.Dest_Code][r.Origin_Code] = r.Risk_Level;
    });

    // C. 處理 RULES, STEPS, REQS (規則主體、步驟和要求)
    const rulesMap = {}; // 用於暫存所有規則，以便步驟和要求可以查找

    // 將所有步驟和要求歸類到 Rule_ID
    data.STEPS.forEach(s => {
        if (!rulesMap[s.Rule_ID]) rulesMap[s.Rule_ID] = { steps: [], requirements: [], contact: [] };
        rulesMap[s.Rule_ID].steps.push({ 
            id: parseInt(s.Step_Order), 
            text: s.Content, 
            time: s.Timeframe 
        });
    });

    data.REQS.forEach(r => {
        if (!rulesMap[r.Rule_ID]) rulesMap[r.Rule_ID] = { steps: [], requirements: [], contact: [] };
        rulesMap[r.Rule_ID].requirements.push(r.Requirement);
    });

    // 將 RULES 主體數據分配到正確的巢狀結構中
    data.RULES.forEach(r => {
        const ruleDetails = rulesMap[r.Rule_ID] || {};
        const destCode = r.Dest_Code;
        const riskLevel = r.Risk_Level;
        const petType = r.Pet_Type;

        if (!newRegs[destCode].rules_by_risk[riskLevel]) {
            newRegs[destCode].rules_by_risk[riskLevel] = {};
        }

        newRegs[destCode].rules_by_risk[riskLevel][petType] = {
            process_title: r.Title,
            steps: ruleDetails.steps || [],
            requirements: ruleDetails.requirements || [],
            contact: [
                `官方單位：${r.Contact_Unit}`,
                r.Contact_Link.startsWith('http') ? `官方連結：[點擊前往](${r.Contact_Link})` : `其他資訊：${r.Contact_Link}`
            ]
        };
        // 儲存通用屬性
        newRegs[destCode].complexity = r.Complexity;
        newRegs[destCode].preparation_time = r.Prep_Time;
    });
    
    return newRegs;
}

/**
 * 數據載入成功後，啟用前端功能
 */
function setupFrontend() {
    const searchButton = document.getElementById('search-button');
    const countryFromInput = document.getElementById('country-from-input');
    const countryToInput = document.getElementById('country-to-input');
    const toggleFromList = document.getElementById('toggle-from-list'); 
    const toggleToList = document.getElementById('toggle-to-list'); 

    // 初始化搜尋框功能
    setupSearchInput('country-from-input', 'country-from-results', 'country-from');
    setupSearchInput('country-to-input', 'country-to-results', 'country-to');

    // 設置預設值 (假設 TW 和 AU 一定存在)
    setInputDefaultValue('country-from-input', 'TW', PET_REGULATIONS.COUNTRIES['TW'] || '台灣');
    setInputDefaultValue('country-to-input', 'AU', PET_REGULATIONS.COUNTRIES['AU'] || '澳洲');
    
    // 啟用按鈕
    searchButton.disabled = false;
    countryFromInput.placeholder = '輸入國家名稱或代碼...';
    countryToInput.placeholder = '輸入國家名稱或代碼...';
    
    // 為箭頭按鈕添加點擊事件
    toggleFromList.addEventListener('click', () => {
        countryFromInput.focus(); 
        countryFromInput.value = '';
        countryFromInput.dispatchEvent(new Event('input')); 
    });

    toggleToList.addEventListener('click', () => {
        countryToInput.focus();
        countryToInput.value = '';
        countryToInput.dispatchEvent(new Event('input'));
    });
    
    // 為查詢按鈕添加事件監聽器
    searchButton.addEventListener('click', searchRegulations);
}

// ------------------------------------------
// II. 核心查詢與顯示邏輯 (與舊版類似，但讀取全局 PET_REGULATIONS)
// ------------------------------------------

// 設置輸入框預設值的輔助函數
function setInputDefaultValue(inputId, code, name) {
    const inputElement = document.getElementById(inputId);
    const hiddenInputElement = document.getElementById(inputId.replace('-input', ''));

    if (inputElement && hiddenInputElement) {
        inputElement.value = name;
        hiddenInputElement.value = code;
        inputElement.dataset.code = code;
    }
}

// 設置搜尋輸入框邏輯
function setupSearchInput(inputId, resultsId, hiddenInputId) {
    const inputElement = document.getElementById(inputId);
    const resultsContainer = document.getElementById(resultsId);
    const hiddenInputElement = document.getElementById(hiddenInputId);

    inputElement.addEventListener('input', () => {
        const query = inputElement.value.trim().toLowerCase();
        
        hiddenInputElement.value = '';
        inputElement.dataset.code = '';
        resultsContainer.innerHTML = '';

        const countries = PET_REGULATIONS.COUNTRIES;
        let found = false;

        for (const code in countries) {
            const name = countries[code];
            if (query === '' || name.toLowerCase().includes(query) || code.toLowerCase().includes(query)) {
                found = true;
                const item = document.createElement('div');
                item.className = 'country-result-item';
                item.textContent = name;
                item.dataset.code = code;
                item.dataset.name = name;
                
                item.addEventListener('click', () => {
                    inputElement.value = item.dataset.name;
                    hiddenInputElement.value = item.dataset.code;
                    inputElement.dataset.code = item.dataset.code;
                    resultsContainer.style.display = 'none';
                });
                resultsContainer.appendChild(item);
            }
        }
        
        resultsContainer.style.display = found ? 'block' : 'none';
    });

    inputElement.addEventListener('focus', () => {
        inputElement.dispatchEvent(new Event('input'));
    });

    inputElement.addEventListener('blur', () => {
        setTimeout(() => {
            resultsContainer.style.display = 'none';
        }, 200);
    });
}


// 核心查詢函數：根據出發國和目的地國家的風險等級查找規定
function searchRegulations() {
    const petType = document.getElementById('pet-type').value;
    const countryFromCode = document.getElementById('country-from').value; 
    const countryToCode = document.getElementById('country-to').value;
    const resultSection = document.getElementById('result-section');
    const resultContent = document.getElementById('result-content');

    // 1. 基礎檢查
    if (!countryFromCode || !countryToCode) {
        alert('請先在輸入框中選擇有效的出發國家和目的地國家。');
        return;
    }
    if (countryFromCode === countryToCode) {
        alert('❌ 出發國家和抵達國家不能相同，請重新選擇！');
        return;
    }
    
    // 2. 獲取數據
    const countryData = PET_REGULATIONS[countryToCode];
    if (!countryData || !countryData.rules_by_risk) { 
        alert(`🚧 抱歉，${PET_REGULATIONS.COUNTRIES[countryToCode]} 的詳細規定資料尚未建立。`);
        return; 
    }

    let riskLevel = '通用/未分級';
    let regulation = null;
    
    // 3. 查找風險等級
    const riskClassification = PET_REGULATIONS.RISK_CLASSIFICATION;
    if (riskClassification && countryToCode in riskClassification) {
        riskLevel = riskClassification[countryToCode][countryFromCode] || 'Unlisted';
        
        // 嘗試使用該等級代號查找具體的規定
        if (countryData.rules_by_risk[riskLevel]) {
            regulation = countryData.rules_by_risk[riskLevel][petType];
        }
    } 
    
    // 4. 最終檢查
    if (!regulation) {
        alert(`🚫 抱歉，尚未找到 ${PET_REGULATIONS.COUNTRIES[countryFromCode]} (分級: ${riskLevel}) 到 ${countryData.name} 的具體規定資料，請檢查 Google Sheets 中該分級的規則是否已建立。`);
        return;
    }

    // 5. 設定標題
    document.getElementById('result-title').innerHTML = 
        `從 <span class="highlight-country">${PET_REGULATIONS.COUNTRIES[countryFromCode]}</span> (分級: ${riskLevel}) 帶 <span class="highlight-pet">${petType === 'Dog' ? '狗' : '貓'}</span> 到 <span class="highlight-country">${countryData.name}</span> 的流程`;
    
    // 6. 組裝結果 HTML
    let html = `
        <div class="summary">
            <p><strong>風險等級判定：</strong> ${riskLevel}</p>
            <p><strong>複雜度：</strong><span class="${countryData.complexity.toLowerCase().includes('高') ? 'highlight-complexity' : ''}">${countryData.complexity}</span></p>
            <p><strong>建議準備時間：：</strong><span class="highlight-time">${countryData.preparation_time}</span></p>
        </div>
        
        <h3>A. 流程時程與步驟 (${regulation.process_title})</h3>
        <table class="steps-table">
            <thead>
                <tr>
                    <th>步驟</th>
                    <th>內容/要求</th>
                    <th>時程/備註</th>
                </tr>
            </thead>
            <tbody>
                ${regulation.steps ? regulation.steps.map(s => `
                    <tr>
                        <td>${s.id}.</td>
                        <td>${s.text}</td>
                        <td>${s.time}</td>
                    </tr>
                `).join('') : '<tr><td colspan="3">目前沒有詳細步驟資料。</td></tr>'}
            </tbody>
        </table>
        
        <h3>B. 官方檢疫規定重點</h3>
        <ul class="requirements-list">
            ${regulation.requirements.map(r => `<li>${r}</li>`).join('')}
        </ul>
        
        <h3>C. 聯絡單位與重要連結</h3>
        <ul class="contact-list">
            ${regulation.contact.map(r => `<li>${r}</li>`).join('')}
        </ul>
        <div class="disclaimer-note">
            ⚠️ **重要聲明：** 本資訊為參考原型，數據來源自您的 Google Sheets。請務必直接聯繫目的地的**官方聯絡單位**確認所有細節。
        </div>
    `;
    
    // 7. 顯示結果
    resultContent.innerHTML = html;
    document.getElementById('query-section').classList.add('hidden');
    resultSection.classList.remove('hidden');

    resultSection.scrollIntoView({ behavior: 'smooth' });
}

// 返回查詢頁面
function resetPage() {
    // 重置 input 欄位
    setInputDefaultValue('country-from-input', 'TW', PET_REGULATIONS.COUNTRIES['TW'] || '台灣');
    setInputDefaultValue('country-to-input', 'AU', PET_REGULATIONS.COUNTRIES['AU'] || '澳洲');

    document.getElementById('result-section').classList.add('hidden');
    document.getElementById('query-section').classList.remove('hidden');
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}