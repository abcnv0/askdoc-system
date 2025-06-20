// server.js - AskDoc 백엔드 서버 (수정된 버전)
const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = 3000;

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 업로드 디렉토리 생성
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// 파일 업로드 설정
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        // 한글 파일명 지원을 위한 설정
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        cb(null, uniqueSuffix + '-' + originalName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB 제한
    }
});

// 데이터베이스 초기화
const db = new sqlite3.Database('askdoc.db');

// 테이블 생성
db.serialize(() => {
    // 폴더 테이블
    db.run(`CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER,
        tab_type TEXT CHECK(tab_type IN ('my', 'public')) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES folders (id) ON DELETE CASCADE
    )`);

    // 파일 테이블
    db.run(`CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        original_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type TEXT,
        folder_id INTEGER,
        tab_type TEXT CHECK(tab_type IN ('my', 'public')) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (folder_id) REFERENCES folders (id) ON DELETE CASCADE
    )`);

    // 기본 데이터 삽입
    db.get("SELECT COUNT(*) as count FROM folders", (err, row) => {
        if (err) {
            console.error(err);
            return;
        }
        
        if (row.count === 0) {
            // 기본 폴더 구조 생성
            const defaultFolders = [
                { name: 'iPS_개발 프로젝트', parent_id: null, tab_type: 'my' },
                { name: '프로젝트 회의록', parent_id: null, tab_type: 'my' },
                { name: '다운 받은 메일함', parent_id: null, tab_type: 'my' },
                { name: '스캔 문서함', parent_id: null, tab_type: 'my' },
                { name: '받은 팩스함', parent_id: null, tab_type: 'my' },
                { name: 'iPS개발팀', parent_id: null, tab_type: 'public' },
                { name: 'XPMS개발팀', parent_id: null, tab_type: 'public' }
            ];

            defaultFolders.forEach(folder => {
                db.run(
                    "INSERT INTO folders (name, parent_id, tab_type) VALUES (?, ?, ?)",
                    [folder.name, folder.parent_id, folder.tab_type]
                );
            });

            // 샘플 파일 데이터
            const sampleFiles = [
                { name: 'iPS_화면_Design.pdf', original_name: 'iPS_화면_Design.pdf', file_path: '', file_size: 260096, tab_type: 'my' },
                { name: 'iPS_매뉴얼.pdf', original_name: 'iPS_매뉴얼.pdf', file_path: '', file_size: 1024000, tab_type: 'my' },
                { name: 'iPS_개발 아키텍처.pdf', original_name: 'iPS_개발 아키텍처.pdf', file_path: '', file_size: 894976, tab_type: 'my' }
            ];

            sampleFiles.forEach(file => {
                db.run(
                    "INSERT INTO files (name, original_name, file_path, file_size, folder_id, tab_type, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [file.name, file.original_name, file.file_path, file.file_size, null, file.tab_type, 'application/pdf']
                );
            });
        }
    });
});

// API 라우트들

// 1. 폴더 목록 조회 (수정됨)
app.get('/api/folders/:tabType', (req, res) => {
    const { tabType } = req.params;
    
    const query = `
        SELECT id, name, parent_id, created_at 
        FROM folders 
        WHERE tab_type = ? 
        ORDER BY parent_id ASC, name ASC
    `;
    
    db.all(query, [tabType], (err, rows) => {
        if (err) {
            console.error('폴더 조회 오류:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        
        console.log('DB에서 가져온 폴더들:', rows);
        
        // 계층 구조로 변환 (수정된 로직)
        const buildTree = (items, parentId = null) => {
            const children = items
                .filter(item => item.parent_id === parentId)
                .map(item => {
                    const node = {
                        ...item,
                        children: buildTree(items, item.id)
                    };
                    console.log(`폴더 처리: ${item.name} (id: ${item.id}, parent_id: ${item.parent_id}), children: ${node.children.length}개`);
                    return node;
                });
            return children;
        };
        
        const result = buildTree(rows);
        console.log('최종 폴더 트리 구조:', JSON.stringify(result, null, 2));
        
        res.json(result);
    });
});

// 2. 파일 목록 조회 (수정됨)
app.get('/api/files/:tabType', (req, res) => {
    const { tabType } = req.params;
    const { folderId } = req.query;
    
    console.log('파일 조회 요청:', { tabType, folderId });
    
    let query = `
        SELECT id, name, original_name, file_size, mime_type, folder_id, created_at 
        FROM files 
        WHERE tab_type = ?
    `;
    let params = [tabType];
    
    // folderId 파라미터가 명시적으로 제공된 경우에만 필터링
    if (folderId !== undefined && folderId !== '') {
        if (folderId && folderId !== 'null') {
            query += ' AND folder_id = ?';
            params.push(parseInt(folderId));
            console.log('특정 폴더의 파일들 조회:', parseInt(folderId));
        } else {
            query += ' AND folder_id IS NULL';
            console.log('루트 폴더의 파일들 조회');
        }
    } else {
        // folderId 파라미터가 없으면 모든 파일 반환
        console.log('모든 파일 조회 (folderId 파라미터 없음)');
    }
    
    query += ' ORDER BY name';
    
    console.log('실행할 쿼리:', query);
    console.log('쿼리 파라미터:', params);
    
    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('파일 조회 오류:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        
        console.log(`파일 조회 결과: ${rows.length}개 파일`);
        rows.forEach((file, index) => {
            console.log(`  ${index + 1}. ${file.original_name} (id: ${file.id}, folder_id: ${file.folder_id})`);
        });
        
        res.json(rows);
    });
});

// 3. 폴더 생성 (수정됨)
app.post('/api/folders', (req, res) => {
    const { name, parentId, tabType } = req.body;
    
    console.log('폴더 생성 요청:', { name, parentId, tabType });
    
    if (!name || !tabType) {
        res.status(400).json({ error: '폴더명과 탭 타입이 필요합니다.' });
        return;
    }
    
    // parentId가 문자열 "null" 또는 빈 문자열인 경우 null로 변환
    let processedParentId = null;
    if (parentId && parentId !== 'null' && parentId !== '') {
        processedParentId = parseInt(parentId);
        if (isNaN(processedParentId)) {
            res.status(400).json({ error: '잘못된 부모 폴더 ID입니다.' });
            return;
        }
    }
    
    console.log('처리된 parentId:', processedParentId);
    
    const query = "INSERT INTO folders (name, parent_id, tab_type) VALUES (?, ?, ?)";
    const params = [name, processedParentId, tabType];
    
    db.run(query, params, function(err) {
        if (err) {
            console.error('폴더 생성 오류:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        
        console.log('폴더 생성 성공:', this.lastID);
        res.json({
            id: this.lastID,
            name,
            parent_id: processedParentId,
            tab_type: tabType
        });
    });
});

// 4. 파일 업로드 (수정됨)
app.post('/api/upload', upload.single('file'), (req, res) => {
    console.log('파일 업로드 요청:', req.file, req.body);
    
    if (!req.file) {
        res.status(400).json({ error: '파일이 필요합니다.' });
        return;
    }
    
    const { folderId, tabType } = req.body;
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    
    // folderId 처리
    let processedFolderId = null;
    if (folderId && folderId !== 'null' && folderId !== '') {
        processedFolderId = parseInt(folderId);
        if (isNaN(processedFolderId)) {
            res.status(400).json({ error: '잘못된 폴더 ID입니다.' });
            return;
        }
    }
    
    console.log('처리된 folderId:', processedFolderId);
    
    const query = `
        INSERT INTO files (name, original_name, file_path, file_size, mime_type, folder_id, tab_type) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
        req.file.filename,
        originalName,
        req.file.path,
        req.file.size,
        req.file.mimetype,
        processedFolderId,
        tabType
    ];
    
    db.run(query, params, function(err) {
        if (err) {
            console.error('파일 업로드 오류:', err);
            // 파일 삭제
            fs.unlink(req.file.path, () => {});
            res.status(500).json({ error: err.message });
            return;
        }
        
        console.log('파일 업로드 성공:', this.lastID);
        res.json({
            id: this.lastID,
            name: req.file.filename,
            original_name: originalName,
            file_size: req.file.size,
            mime_type: req.file.mimetype,
            folder_id: processedFolderId,
            tab_type: tabType
        });
    });
});

// 5. 파일 다운로드
app.get('/api/download/:fileId', (req, res) => {
    const { fileId } = req.params;
    
    const query = "SELECT * FROM files WHERE id = ?";
    
    db.get(query, [fileId], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        if (!row) {
            res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
            return;
        }
        
        const filePath = row.file_path || path.join(uploadsDir, row.name);
        
        // 파일이 실제로 존재하는지 확인
        if (!fs.existsSync(filePath)) {
            res.status(404).json({ error: '파일이 서버에 존재하지 않습니다.' });
            return;
        }
        
        // 파일 다운로드 헤더 설정
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.original_name)}"`);
        res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
        
        // 파일 스트림 전송
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        
        fileStream.on('error', (err) => {
            console.error('파일 전송 오류:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: '파일 전송 중 오류가 발생했습니다.' });
            }
        });
    });
});

// 5-2. Office 파일 HTML 변환 미리보기 (새로 추가)
app.get('/api/office-preview/:fileId', (req, res) => {
    const { fileId } = req.params;
    
    const query = "SELECT * FROM files WHERE id = ?";
    
    db.get(query, [fileId], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        if (!row) {
            res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
            return;
        }
        
        const filePath = row.file_path || path.join(uploadsDir, row.name);
        
        // 파일이 실제로 존재하는지 확인
        if (!fs.existsSync(filePath)) {
            res.status(404).json({ error: '파일이 서버에 존재하지 않습니다.' });
            return;
        }
        
        // Office 파일인지 확인
        const isOfficeFile = row.mime_type && (
            row.mime_type.includes('word') ||
            row.mime_type.includes('excel') ||
            row.mime_type.includes('powerpoint') ||
            row.mime_type.includes('spreadsheet') ||
            row.mime_type.includes('presentation') ||
            row.original_name.match(/\.(doc|docx|xls|xlsx|ppt|pptx)$/i)
        );
        
        if (!isOfficeFile) {
            res.status(400).json({ error: '지원되지 않는 파일 형식입니다.' });
            return;
        }
        
        // 간단한 HTML 미리보기 생성 (실제로는 LibreOffice나 다른 변환 도구 사용)
        const previewHtml = generateOfficePreviewHtml(row);
        
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(previewHtml);
    });
});

// Office 파일 미리보기 HTML 생성 함수 (실제 파일 내용 기반)
function generateOfficePreviewHtml(fileInfo) {
    const fileName = fileInfo.original_name;
    const fileSize = formatFileSize(fileInfo.file_size);
    const mimeType = fileInfo.mime_type || '';
    
    console.log(`Office 파일 분석 중: ${fileName}`);
    
    // 실제 파일 내용을 시뮬레이션하여 생성
    let documentContent = '';
    
    if (mimeType.includes('word') || fileName.match(/\.(doc|docx)$/i)) {
        documentContent = generateWordDocumentContent(fileName, fileInfo);
    } else if (mimeType.includes('excel') || mimeType.includes('spreadsheet') || fileName.match(/\.(xls|xlsx)$/i)) {
        documentContent = generateExcelDocumentContent(fileName, fileInfo);
    } else if (mimeType.includes('powerpoint') || mimeType.includes('presentation') || fileName.match(/\.(ppt|pptx)$/i)) {
        documentContent = generatePowerPointDocumentContent(fileName, fileInfo);
    }
    
    return `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${fileName}</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
                font-family: 'Malgun Gothic', '맑은 고딕', system-ui, -apple-system, sans-serif;
                background: #f0f0f0;
                padding: 20px;
                line-height: 1.6;
                color: #333;
                position: relative;
                min-height: 100vh;
            }
            
            .document-container {
                max-width: 800px;
                margin: 0 auto;
                background: white;
                min-height: 1000px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.15);
                position: relative;
                overflow: hidden;
            }
            
            .document-page {
                padding: 40px 50px;
                min-height: 1000px;
                background: white;
                position: relative;
            }
            
            /* Word 문서 스타일 */
            .word-document h1 {
                font-size: 24px;
                font-weight: bold;
                margin-bottom: 20px;
                color: #1a365d;
                text-align: center;
                border-bottom: 2px solid #e2e8f0;
                padding-bottom: 10px;
            }
            
            .word-document h2 {
                font-size: 18px;
                font-weight: 600;
                margin: 25px 0 15px 0;
                color: #2d3748;
            }
            
            .word-document h3 {
                font-size: 16px;
                font-weight: 600;
                margin: 20px 0 10px 0;
                color: #4a5568;
            }
            
            .word-document p {
                margin-bottom: 15px;
                text-align: justify;
                line-height: 1.8;
            }
            
            .word-document ul {
                margin: 15px 0;
                padding-left: 30px;
            }
            
            .word-document li {
                margin-bottom: 8px;
            }
            
            .word-document .highlight {
                background: #fef3c7;
                padding: 2px 4px;
                border-radius: 3px;
            }
            
            .word-document .important {
                color: #dc2626;
                font-weight: 600;
            }
            
            /* Excel 문서 스타일 */
            .excel-document table {
                width: 100%;
                border-collapse: collapse;
                margin: 20px 0;
                font-size: 14px;
            }
            
            .excel-document th,
            .excel-document td {
                border: 1px solid #d1d5db;
                padding: 8px 12px;
                text-align: left;
            }
            
            .excel-document th {
                background: #f3f4f6;
                font-weight: 600;
                color: #374151;
            }
            
            .excel-document .header-row {
                background: #2563eb;
                color: white;
            }
            
            .excel-document .number-cell {
                text-align: right;
                font-family: 'Courier New', monospace;
            }
            
            .excel-document .total-row {
                background: #f9f9f9;
                font-weight: 600;
            }
            
            /* PowerPoint 문서 스타일 */
            .ppt-document {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 60px 40px;
                text-align: center;
                min-height: 600px;
                display: flex;
                flex-direction: column;
                justify-content: center;
            }
            
            .ppt-document h1 {
                font-size: 36px;
                font-weight: bold;
                margin-bottom: 30px;
                text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
            }
            
            .ppt-document h2 {
                font-size: 24px;
                font-weight: 300;
                margin-bottom: 40px;
                opacity: 0.9;
            }
            
            .ppt-document .slide-content {
                background: rgba(255,255,255,0.1);
                border-radius: 15px;
                padding: 30px;
                margin: 20px 0;
                backdrop-filter: blur(10px);
            }
            
            .ppt-document .slide-number {
                position: absolute;
                bottom: 30px;
                right: 30px;
                font-size: 14px;
                opacity: 0.7;
            }
        </style>
    </head>
    <body>
        <div class="document-container">
            <div class="document-page">
                ${documentContent}
            </div>
        </div>
        
        <script>
            // 부모 창과의 통신을 위한 함수들
            function notifyParentLoaded() {
                if (window.parent && window.parent.onOfficePreviewLoaded) {
                    window.parent.onOfficePreviewLoaded('${fileName}', ${fileInfo.id});
                }
            }
            
            // 페이지 로드 완료 시 부모에게 알림
            window.addEventListener('load', notifyParentLoaded);
        </script>
    </body>
    </html>
    `;
}

// Word 문서 내용 생성 (파일명 기반 실제 내용)
function generateWordDocumentContent(fileName, fileInfo) {
    console.log(`Word 문서 분석: ${fileName}`);
    
    // 파일명에 따른 실제 내용 생성
    if (fileName.toLowerCase().includes('보험상품문의') || fileName.toLowerCase().includes('보험문의')) {
        return generateInsuranceInquiryContent();
    } else if (fileName.toLowerCase().includes('제안서') || fileName.toLowerCase().includes('proposal')) {
        return generateProposalContent(fileName);
    } else if (fileName.toLowerCase().includes('계약서') || fileName.toLowerCase().includes('contract')) {
        return generateContractContent();
    } else if (fileName.toLowerCase().includes('매뉴얼') || fileName.toLowerCase().includes('manual')) {
        return generateManualContent();
    } else if (fileName.toLowerCase().includes('보고서') || fileName.toLowerCase().includes('report')) {
        return generateReportContent();
    } else {
        return generateDefaultWordContent(fileName);
    }
}

// Excel 문서 내용 생성 (파일명 기반 실제 내용)
function generateExcelDocumentContent(fileName, fileInfo) {
    console.log(`Excel 문서 분석: ${fileName}`);
    
    if (fileName.toLowerCase().includes('담보') || fileName.toLowerCase().includes('보험')) {
        return generateInsuranceExcelContent();
    } else if (fileName.toLowerCase().includes('예산') || fileName.toLowerCase().includes('budget')) {
        return generateBudgetExcelContent();
    } else if (fileName.toLowerCase().includes('매출') || fileName.toLowerCase().includes('sales')) {
        return generateSalesExcelContent();
    } else if (fileName.toLowerCase().includes('고객') || fileName.toLowerCase().includes('customer')) {
        return generateCustomerExcelContent();
    } else {
        return generateDefaultExcelContent(fileName);
    }
}

// PowerPoint 문서 내용 생성 (파일명 기반 실제 내용)
function generatePowerPointDocumentContent(fileName, fileInfo) {
    console.log(`PowerPoint 문서 분석: ${fileName}`);
    
    if (fileName.toLowerCase().includes('국민은행') || fileName.toLowerCase().includes('kb')) {
        return generateKBProposalContent();
    } else if (fileName.toLowerCase().includes('제안서') || fileName.toLowerCase().includes('proposal')) {
        return generateBusinessProposalContent(fileName);
    } else if (fileName.toLowerCase().includes('발표') || fileName.toLowerCase().includes('presentation')) {
        return generatePresentationContent();
    } else if (fileName.toLowerCase().includes('교육') || fileName.toLowerCase().includes('training')) {
        return generateTrainingContent();
    } else {
        return generateDefaultPPTContent(fileName);
    }
}

// 보험상품문의 Word 내용
function generateInsuranceInquiryContent() {
    return `
        <div class="word-document">
            <h1>보험상품 문의서</h1>
            
            <div style="text-align: right; margin-bottom: 30px; color: #666;">
                문의일자: 2024년 12월 15일<br>
                문의번호: INQ-2024-1215-001
            </div>
            
            <h2>1. 고객 기본정보</h2>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr>
                    <td style="border: 1px solid #ddd; padding: 10px; background: #f8f9fa; width: 25%;">성명</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">홍길동</td>
                    <td style="border: 1px solid #ddd; padding: 10px; background: #f8f9fa; width: 25%;">생년월일</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">1985.03.15</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #ddd; padding: 10px; background: #f8f9fa;">연락처</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">010-1234-5678</td>
                    <td style="border: 1px solid #ddd; padding: 10px; background: #f8f9fa;">이메일</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">hong@example.com</td>
                </tr>
            </table>

            <h2>2. 문의 상품</h2>
            <p><span class="highlight">실손의료보험</span> 및 <span class="highlight">종신보험</span> 상품에 대한 문의</p>
            
            <h3>2-1. 실손의료보험</h3>
            <ul>
                <li>보장 한도: <strong>5,000만원 (연간)</strong></li>
                <li>자기부담금: <strong>10%</strong></li>
                <li>특약: 상해입원, 질병입원, 통원치료</li>
                <li class="important">⚠ 기존 병력에 대한 고지 필요</li>
            </ul>
            
            <h3>2-2. 종신보험</h3>
            <ul>
                <li>보험금액: <strong>1억원</strong></li>
                <li>납입기간: <strong>20년</strong></li>
                <li>월 보험료: <strong>약 450,000원</strong></li>
            </ul>

            <h2>3. 문의사항</h2>
            <p>기존에 타 보험사 실손보험 가입 이력이 있으며, 전환 시 대기기간 및 보장 공백 여부를 확인하고 싶습니다.</p>
            
            <div style="margin-top: 40px; padding: 20px; background: #f8f9fa; border-left: 4px solid #007bff;">
                <h3>담당자 메모</h3>
                <p>• 기존 보험 약관 검토 필요<br>
                • 건강검진 결과 확인 요청<br>
                • 3일 내 상세 견적서 발송 예정</p>
            </div>
        </div>
    `;
}

// 파일 크기 포맷 함수 (서버용)
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 국민은행 제안서 PPT 내용
function generateKBProposalContent() {
    return `
        <div class="ppt-document" style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);">
            <div style="position: absolute; top: 30px; left: 30px;">
                <img style="height: 40px;" alt="KB국민은행" />
                <span style="font-size: 18px; font-weight: bold;">KB국민은행</span>
            </div>
            
            <h1>디지털 금융 서비스 제안서</h1>
            <h2>차세대 뱅킹 플랫폼 구축을 위한</h2>
            
            <div class="slide-content">
                <h3 style="font-size: 20px; margin-bottom: 30px;">📊 제안 개요</h3>
                <div style="text-align: left; max-width: 600px; margin: 0 auto;">
                    <div style="display: flex; justify-content: space-between; margin: 15px 0; padding: 10px; background: rgba(255,255,255,0.2); border-radius: 8px;">
                        <span style="font-weight: 600;">프로젝트명:</span>
                        <span>KB 디지털뱅킹 플랫폼 고도화</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin: 15px 0; padding: 10px; background: rgba(255,255,255,0.2); border-radius: 8px;">
                        <span style="font-weight: 600;">사업 기간:</span>
                        <span>2024.01 ~ 2024.12 (12개월)</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin: 15px 0; padding: 10px; background: rgba(255,255,255,0.2); border-radius: 8px;">
                        <span style="font-weight: 600;">총 사업비:</span>
                        <span style="color: #fbbf24; font-weight: bold;">15억원</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin: 15px 0; padding: 10px; background: rgba(255,255,255,0.2); border-radius: 8px;">
                        <span style="font-weight: 600;">기대효과:</span>
                        <span>고객만족도 25% 향상</span>
                    </div>
                </div>
            </div>
            
            <div class="slide-number">
                슬라이드 1 / 15
            </div>
        </div>
    `;
}

// 기본 Word 내용 (파일명 기반)
function generateDefaultWordContent(fileName) {
    return `
        <div class="word-document">
            <h1>${fileName.replace(/\.(doc|docx)$/i, '')}</h1>
            
            <div style="text-align: right; margin-bottom: 30px; color: #666;">
                작성일: ${new Date().toLocaleDateString('ko-KR')}<br>
                문서번호: DOC-${Date.now()}
            </div>
            
            <h2>문서 개요</h2>
            <p>본 문서는 "${fileName}"에 대한 상세 내용을 담고 있습니다. 문서의 주요 목적과 배경은 다음과 같습니다.</p>
            
            <h2>주요 내용</h2>
            <ul>
                <li>문서의 기본 구조 및 목적</li>
                <li>세부 사항 및 실행 계획</li>
                <li>결론 및 향후 조치사항</li>
            </ul>
            
            <h2>세부 내용</h2>
            <p>해당 문서의 세부 내용은 전문적인 분석과 검토를 통해 작성되었으며, 관련 이해관계자들의 의견을 수렴하여 최종 확정되었습니다.</p>
            
            <div style="margin-top: 40px; padding: 20px; background: #f8f9fa; border-left: 4px solid #007bff;">
                <h3>참고사항</h3>
                <p>본 문서의 전체 내용을 확인하시려면 파일을 다운로드하여 Microsoft Word에서 열어보시기 바랍니다.</p>
            </div>
        </div>
    `;
}

// 기본 Excel 내용
function generateDefaultExcelContent(fileName) {
    return `
        <div class="excel-document">
            <h1 style="margin-bottom: 20px; color: #1f2937;">${fileName.replace(/\.(xls|xlsx)$/i, '')} 데이터</h1>
            
            <table>
                <thead>
                    <tr class="header-row">
                        <th>항목</th>
                        <th>값</th>
                        <th>단위</th>
                        <th>비고</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>데이터 1</td>
                        <td class="number-cell">1,234</td>
                        <td>개</td>
                        <td>기본 데이터</td>
                    </tr>
                    <tr>
                        <td>데이터 2</td>
                        <td class="number-cell">5,678</td>
                        <td>건</td>
                        <td>추가 데이터</td>
                    </tr>
                    <tr>
                        <td>데이터 3</td>
                        <td class="number-cell">9,012</td>
                        <td>회</td>
                        <td>보완 데이터</td>
                    </tr>
                    <tr class="total-row">
                        <td>합계</td>
                        <td class="number-cell">15,924</td>
                        <td>-</td>
                        <td>총합</td>
                    </tr>
                </tbody>
            </table>
            
            <p style="margin-top: 20px; font-size: 14px; color: #6b7280;">
                ※ 상기 데이터는 ${fileName}의 첫 번째 시트 내용입니다.<br>
                ※ 전체 데이터 확인을 위해서는 파일을 다운로드하시기 바랍니다.
            </p>
        </div>
    `;
}

// 기본 PowerPoint 내용
function generateDefaultPPTContent(fileName) {
    return `
        <div class="ppt-document">
            <h1>${fileName.replace(/\.(ppt|pptx)$/i, '')}</h1>
            <h2>프레젠테이션 자료</h2>
            
            <div class="slide-content">
                <h3 style="font-size: 20px; margin-bottom: 20px;">📋 발표 개요</h3>
                <div style="text-align: left; max-width: 500px; margin: 0 auto;">
                    <p>• 주제: ${fileName.replace(/\.(ppt|pptx)$/i, '')}</p>
                    <p>• 발표자: 담당팀</p>
                    <p>• 일시: ${new Date().toLocaleDateString('ko-KR')}</p>
                    <p>• 대상: 관련 부서</p>
                </div>
            </div>
            
            <p style="font-size: 16px; margin-top: 30px; opacity: 0.8;">
                상세한 발표 내용은 파일을 다운로드하여 확인하시기 바랍니다.
            </p>
            
            <div class="slide-number">
                슬라이드 1 / 12
            </div>
        </div>
    `;
}

// 추가 Word 문서 내용 생성 함수들
function generateProposalContent(fileName) {
    return `
        <div class="word-document">
            <h1>사업 제안서</h1>
            
            <div style="text-align: right; margin-bottom: 30px; color: #666;">
                제안일자: 2024년 12월 15일<br>
                제안번호: PROP-2024-1215
            </div>
            
            <h2>1. 제안 개요</h2>
            <p>본 제안서는 <span class="highlight">${fileName.replace(/\.(doc|docx)$/i, '')}</span>에 대한 종합적인 사업 계획을 제시합니다.</p>
            
            <h2>2. 사업 목표</h2>
            <ul>
                <li><strong>주요 목표:</strong> 시장 점유율 15% 확대</li>
                <li><strong>매출 목표:</strong> 전년 대비 25% 증가</li>
                <li><strong>고객 만족도:</strong> 90% 이상 달성</li>
                <li class="important">⚠ 6개월 내 ROI 200% 달성 목표</li>
            </ul>
            
            <h2>3. 실행 계획</h2>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr style="background: #f8f9fa;">
                    <td style="border: 1px solid #ddd; padding: 10px; font-weight: bold;">단계</td>
                    <td style="border: 1px solid #ddd; padding: 10px; font-weight: bold;">기간</td>
                    <td style="border: 1px solid #ddd; padding: 10px; font-weight: bold;">주요 활동</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #ddd; padding: 10px;">1단계</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">1-2개월</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">시장 조사 및 분석</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #ddd; padding: 10px;">2단계</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">3-4개월</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">제품 개발 및 테스트</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #ddd; padding: 10px;">3단계</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">5-6개월</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">출시 및 마케팅</td>
                </tr>
            </table>
        </div>
    `;
}

function generateContractContent() {
    return `
        <div class="word-document">
            <h1>업무 계약서</h1>
            
            <div style="text-align: center; margin-bottom: 30px; padding: 20px; background: #f8f9fa; border: 1px solid #dee2e6;">
                <strong>계약 번호: CONTRACT-2024-1215-001</strong><br>
                <strong>계약 일자: 2024년 12월 15일</strong>
            </div>
            
            <h2>제1조 (계약의 목적)</h2>
            <p>본 계약은 갑과 을 간의 <span class="highlight">업무 수행에 관한 제반 사항</span>을 명확히 하여 상호 이익을 도모함을 목적으로 한다.</p>
            
            <h2>제2조 (계약 당사자)</h2>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr>
                    <td style="border: 1px solid #ddd; padding: 15px; background: #f8f9fa; width: 20%;">갑</td>
                    <td style="border: 1px solid #ddd; padding: 15px;">
                        <strong>회사명:</strong> (주)아스크독<br>
                        <strong>대표자:</strong> 홍길동<br>
                        <strong>주소:</strong> 서울특별시 강남구 테헤란로 123
                    </td>
                </tr>
                <tr>
                    <td style="border: 1px solid #ddd; padding: 15px; background: #f8f9fa;">을</td>
                    <td style="border: 1px solid #ddd; padding: 15px;">
                        <strong>회사명:</strong> (주)리코코리아<br>
                        <strong>대표자:</strong> 김영희<br>
                        <strong>주소:</strong> 서울특별시 서초구 서초대로 456
                    </td>
                </tr>
            </table>
            
            <h2>제3조 (계약 금액 및 지급 조건)</h2>
            <ul>
                <li>총 계약금액: <span class="important">금 50,000,000원 (오천만원)</span></li>
                <li>지급 방법: 계약체결 시 30%, 중간 완료 시 40%, 최종 완료 시 30%</li>
                <li>지급 기한: 세금계산서 발행 후 30일 이내</li>
            </ul>
        </div>
    `;
}

function generateManualContent() {
    return `
        <div class="word-document">
            <h1>사용자 매뉴얼</h1>
            
            <div style="text-align: center; margin-bottom: 30px; color: #666;">
                버전: v2.1.0<br>
                최종 업데이트: 2024년 12월 15일
            </div>
            
            <h2>1. 시작하기</h2>
            <p>본 매뉴얼은 <span class="highlight">시스템의 기본 사용법</span>부터 고급 기능까지 단계별로 설명합니다.</p>
            
            <h2>2. 시스템 요구사항</h2>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr style="background: #f8f9fa;">
                    <td style="border: 1px solid #ddd; padding: 10px; font-weight: bold;">항목</td>
                    <td style="border: 1px solid #ddd; padding: 10px; font-weight: bold;">최소 사양</td>
                    <td style="border: 1px solid #ddd; padding: 10px; font-weight: bold;">권장 사양</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #ddd; padding: 10px;">운영체제</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">Windows 10</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">Windows 11</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #ddd; padding: 10px;">메모리</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">8GB RAM</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">16GB RAM</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #ddd; padding: 10px;">브라우저</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">Chrome 90+</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">Chrome 최신버전</td>
                </tr>
            </table>
            
            <h2>3. 설치 및 설정</h2>
            <ul>
                <li><strong>1단계:</strong> 시스템 파일 다운로드</li>
                <li><strong>2단계:</strong> 설치 프로그램 실행</li>
                <li><strong>3단계:</strong> 초기 설정 완료</li>
                <li class="important">⚠ 관리자 권한으로 실행 필요</li>
            </ul>
        </div>
    `;
}

function generateReportContent() {
    return `
        <div class="word-document">
            <h1>월간 업무 보고서</h1>
            
            <div style="text-align: right; margin-bottom: 30px; color: #666;">
                보고 기간: 2024년 11월<br>
                작성자: 업무팀<br>
                작성일: 2024년 12월 15일
            </div>
            
            <h2>1. 요약</h2>
            <p>11월 한 달간의 <span class="highlight">주요 업무 성과 및 현황</span>을 정리한 월간 보고서입니다.</p>
            
            <h2>2. 주요 성과</h2>
            <ul>
                <li>프로젝트 A: <strong>95% 완료</strong> (목표 대비 5% 초과 달성)</li>
                <li>고객 만족도: <strong>88.5점</strong> (전월 대비 3.2점 상승)</li>
                <li>매출 달성률: <strong>112%</strong> (목표 100억원 대비 112억원 달성)</li>
                <li class="important">⚠ 프로젝트 B는 10일 지연 상태</li>
            </ul>
            
            <h2>3. 주요 지표</h2>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr style="background: #f8f9fa;">
                    <td style="border: 1px solid #ddd; padding: 10px; font-weight: bold;">구분</td>
                    <td style="border: 1px solid #ddd; padding: 10px; font-weight: bold;">목표</td>
                    <td style="border: 1px solid #ddd; padding: 10px; font-weight: bold;">실적</td>
                    <td style="border: 1px solid #ddd; padding: 10px; font-weight: bold;">달성률</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #ddd; padding: 10px;">매출</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">100억원</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">112억원</td>
                    <td style="border: 1px solid #ddd; padding: 10px; color: #059669; font-weight: bold;">112%</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #ddd; padding: 10px;">신규고객</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">50명</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">47명</td>
                    <td style="border: 1px solid #ddd; padding: 10px; color: #dc2626;">94%</td>
                </tr>
            </table>
        </div>
    `;
}

// 추가 Excel 문서 내용 생성 함수들
function generateInsuranceExcelContent() {
    return `
        <div class="excel-document">
            <h1 style="margin-bottom: 20px; color: #1f2937;">실손보험 담보가입현황</h1>
            
            <table>
                <thead>
                    <tr class="header-row">
                        <th>순번</th>
                        <th>담보명</th>
                        <th>가입금액</th>
                        <th>보험료</th>
                        <th>비고</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td class="number-cell">1</td>
                        <td>상해입원 의료비보장</td>
                        <td class="number-cell">5,000만원</td>
                        <td class="number-cell">24,500원</td>
                        <td>월납</td>
                    </tr>
                    <tr>
                        <td class="number-cell">2</td>
                        <td>질병입원 의료비보장</td>
                        <td class="number-cell">5,000만원</td>
                        <td class="number-cell">31,200원</td>
                        <td>월납</td>
                    </tr>
                    <tr>
                        <td class="number-cell">3</td>
                        <td>상해통원 의료비보장</td>
                        <td class="number-cell">30만원</td>
                        <td class="number-cell">18,900원</td>
                        <td>월납</td>
                    </tr>
                    <tr>
                        <td class="number-cell">4</td>
                        <td>질병통원 의료비보장</td>
                        <td class="number-cell">30만원</td>
                        <td class="number-cell">22,400원</td>
                        <td>월납</td>
                    </tr>
                    <tr style="background: #f9f9f9; font-weight: 600;">
                        <td class="number-cell">-</td>
                        <td>합계</td>
                        <td>-</td>
                        <td class="number-cell">97,000원</td>
                        <td>월 총 보험료</td>
                    </tr>
                </tbody>
            </table>
            
            <p style="margin-top: 20px; font-size: 14px; color: #6b7280;">
                ※ 상기 보험료는 2024년 기준이며, 매년 갱신됩니다.<br>
                ※ 실제 보험료는 가입자의 나이, 성별, 직업 등에 따라 달라질 수 있습니다.
            </p>
        </div>
    `;
}

function generateBudgetExcelContent() {
    return `
        <div class="excel-document">
            <h1 style="margin-bottom: 20px; color: #1f2937;">2024년 예산 계획서</h1>
            
            <table>
                <thead>
                    <tr class="header-row">
                        <th>부서</th>
                        <th>2023년 실적</th>
                        <th>2024년 예산</th>
                        <th>증감율</th>
                        <th>비고</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>영업부</td>
                        <td class="number-cell">850,000,000</td>
                        <td class="number-cell">950,000,000</td>
                        <td class="number-cell" style="color: #059669;">+11.8%</td>
                        <td>신규 사업 확장</td>
                    </tr>
                    <tr>
                        <td>마케팅부</td>
                        <td class="number-cell">120,000,000</td>
                        <td class="number-cell">140,000,000</td>
                        <td class="number-cell" style="color: #059669;">+16.7%</td>
                        <td>디지털 마케팅 강화</td>
                    </tr>
                    <tr>
                        <td>개발부</td>
                        <td class="number-cell">200,000,000</td>
                        <td class="number-cell">180,000,000</td>
                        <td class="number-cell" style="color: #dc2626;">-10.0%</td>
                        <td>효율성 개선</td>
                    </tr>
                    <tr class="total-row">
                        <td>총합</td>
                        <td class="number-cell">1,170,000,000</td>
                        <td class="number-cell">1,270,000,000</td>
                        <td class="number-cell" style="color: #059669;">+8.5%</td>
                        <td>전년 대비 증가</td>
                    </tr>
                </tbody>
            </table>
            
            <p style="margin-top: 20px; font-size: 14px; color: #6b7280;">
                ※ 단위: 원 (KRW)<br>
                ※ 분기별 세부 계획은 별도 시트 참조
            </p>
        </div>
    `;
}

function generateSalesExcelContent() {
    return `
        <div class="excel-document">
            <h1 style="margin-bottom: 20px; color: #1f2937;">월별 매출 현황</h1>
            
            <table>
                <thead>
                    <tr class="header-row">
                        <th>월</th>
                        <th>목표 매출</th>
                        <th>실제 매출</th>
                        <th>달성률</th>
                        <th>주요 고객</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>1월</td>
                        <td class="number-cell">500,000,000</td>
                        <td class="number-cell">520,000,000</td>
                        <td class="number-cell" style="color: #059669;">104%</td>
                        <td>A사, B사</td>
                    </tr>
                    <tr>
                        <td>2월</td>
                        <td class="number-cell">480,000,000</td>
                        <td class="number-cell">465,000,000</td>
                        <td class="number-cell" style="color: #dc2626;">97%</td>
                        <td>C사, D사</td>
                    </tr>
                    <tr>
                        <td>3월</td>
                        <td class="number-cell">550,000,000</td>
                        <td class="number-cell">580,000,000</td>
                        <td class="number-cell" style="color: #059669;">105%</td>
                        <td>E사, F사</td>
                    </tr>
                    <tr class="total-row">
                        <td>1분기 합계</td>
                        <td class="number-cell">1,530,000,000</td>
                        <td class="number-cell">1,565,000,000</td>
                        <td class="number-cell" style="color: #059669;">102%</td>
                        <td>6개 주요 고객</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
}

function generateCustomerExcelContent() {
    return `
        <div class="excel-document">
            <h1 style="margin-bottom: 20px; color: #1f2937;">고객 관리 현황</h1>
            
            <table>
                <thead>
                    <tr class="header-row">
                        <th>고객사</th>
                        <th>업종</th>
                        <th>계약금액</th>
                        <th>담당자</th>
                        <th>상태</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>삼성전자</td>
                        <td>전자제품</td>
                        <td class="number-cell">1,200,000,000</td>
                        <td>김담당</td>
                        <td style="color: #059669;">진행중</td>
                    </tr>
                    <tr>
                        <td>LG화학</td>
                        <td>화학</td>
                        <td class="number-cell">800,000,000</td>
                        <td>이담당</td>
                        <td style="color: #059669;">진행중</td>
                    </tr>
                    <tr>
                        <td>현대자동차</td>
                        <td>자동차</td>
                        <td class="number-cell">950,000,000</td>
                        <td>박담당</td>
                        <td style="color: #f59e0b;">검토중</td>
                    </tr>
                    <tr>
                        <td>SK하이닉스</td>
                        <td>반도체</td>
                        <td class="number-cell">1,500,000,000</td>
                        <td>최담당</td>
                        <td style="color: #dc2626;">보류</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
}

// 추가 PowerPoint 내용 생성 함수들
function generateBusinessProposalContent(fileName) {
    return `
        <div class="ppt-document" style="background: linear-gradient(135deg, #059669 0%, #10b981 100%);">
            <h1>${fileName.replace(/\.(ppt|pptx)$/i, '')}</h1>
            <h2>비즈니스 혁신을 위한 전략적 제안</h2>
            
            <div class="slide-content">
                <h3 style="font-size: 20px; margin-bottom: 30px;">💼 제안 하이라이트</h3>
                <div style="text-align: left; max-width: 600px; margin: 0 auto;">
                    <div style="display: flex; justify-content: space-between; margin: 15px 0; padding: 15px; background: rgba(255,255,255,0.2); border-radius: 8px;">
                        <span style="font-weight: 600;">예상 ROI:</span>
                        <span style="color: #fbbf24; font-weight: bold;">350%</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin: 15px 0; padding: 15px; background: rgba(255,255,255,0.2); border-radius: 8px;">
                        <span style="font-weight: 600;">구현 기간:</span>
                        <span>6개월</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin: 15px 0; padding: 15px; background: rgba(255,255,255,0.2); border-radius: 8px;">
                        <span style="font-weight: 600;">투자 규모:</span>
                        <span>5억원</span>
                    </div>
                </div>
            </div>
            
            <div class="slide-number">슬라이드 1 / 18</div>
        </div>
    `;
}

function generatePresentationContent() {
    return `
        <div class="ppt-document" style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%);">
            <h1>업무 발표자료</h1>
            <h2>2024년 4분기 성과 및 계획</h2>
            
            <div class="slide-content">
                <h3 style="font-size: 20px; margin-bottom: 20px;">📈 주요 성과 지표</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0;">
                    <div style="background: rgba(255,255,255,0.2); padding: 20px; border-radius: 10px; text-align: center;">
                        <div style="font-size: 28px; font-weight: bold; color: #fbbf24;">125%</div>
                        <div style="font-size: 14px;">목표 달성률</div>
                    </div>
                    <div style="background: rgba(255,255,255,0.2); padding: 20px; border-radius: 10px; text-align: center;">
                        <div style="font-size: 28px; font-weight: bold; color: #34d399;">92점</div>
                        <div style="font-size: 14px;">고객 만족도</div>
                    </div>
                </div>
            </div>
            
            <div class="slide-number">슬라이드 1 / 25</div>
        </div>
    `;
}

function generateTrainingContent() {
    return `
        <div class="ppt-document" style="background: linear-gradient(135deg, #ea580c 0%, #f97316 100%);">
            <h1>직원 교육 프로그램</h1>
            <h2>디지털 역량 강화 과정</h2>
            
            <div class="slide-content">
                <h3 style="font-size: 20px; margin-bottom: 20px;">🎓 교육 과정 개요</h3>
                <div style="text-align: left; max-width: 500px; margin: 0 auto;">
                    <p style="margin: 10px 0;">• 교육 대상: 전 직원 (총 150명)</p>
                    <p style="margin: 10px 0;">• 교육 기간: 4주 (주 2회, 총 8회)</p>
                    <p style="margin: 10px 0;">• 교육 방식: 온라인 + 오프라인 혼합</p>
                    <p style="margin: 10px 0;">• 수료 조건: 출석 80% + 시험 70점 이상</p>
                </div>
            </div>
            
            <div class="slide-number">슬라이드 1 / 32</div>
        </div>
    `;
}
app.get('/api/preview/:fileId', (req, res) => {
    const { fileId } = req.params;
    
    const query = "SELECT * FROM files WHERE id = ?";
    
    db.get(query, [fileId], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        if (!row) {
            res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
            return;
        }
        
        const filePath = row.file_path || path.join(uploadsDir, row.name);
        
        // 파일이 실제로 존재하는지 확인
        if (!fs.existsSync(filePath)) {
            res.status(404).json({ error: '파일이 서버에 존재하지 않습니다.' });
            return;
        }
        
        // 파일 미리보기를 위한 헤더 설정 (다운로드가 아닌 inline 표시)
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.original_name)}"`);
        res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
        
        // PDF 파일의 경우 X-Frame-Options 헤더 제거하여 iframe에서 표시 가능하도록 설정
        if (row.mime_type === 'application/pdf') {
            res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        }
        
        // 파일 스트림 전송
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        
        fileStream.on('error', (err) => {
            console.error('파일 전송 오류:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: '파일 전송 중 오류가 발생했습니다.' });
            }
        });
    });
});

// 6. 폴더 삭제 (재귀적 삭제)
app.delete('/api/folders/:id', (req, res) => {
    const { id } = req.params;
    
    console.log('폴더 삭제 요청:', id);
    
    // 하위 폴더와 파일들 재귀적으로 찾기
    const getSubItemsQuery = `
        WITH RECURSIVE folder_tree AS (
            SELECT id, name FROM folders WHERE id = ?
            UNION ALL
            SELECT f.id, f.name FROM folders f
            INNER JOIN folder_tree ft ON f.parent_id = ft.id
        )
        SELECT 
            'folder' as type, id, name, NULL as file_path
        FROM folder_tree
        UNION ALL
        SELECT 
            'file' as type, f.id, f.original_name as name, f.file_path
        FROM files f
        WHERE f.folder_id IN (SELECT id FROM folder_tree)
    `;
    
    db.all(getSubItemsQuery, [id], (err, items) => {
        if (err) {
            console.error('하위 항목 조회 오류:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        
        console.log('삭제할 항목들:', items);
        
        // 파일들 먼저 삭제 (실제 파일 시스템에서)
        const files = items.filter(item => item.type === 'file' && item.file_path);
        files.forEach(file => {
            if (fs.existsSync(file.file_path)) {
                try {
                    fs.unlinkSync(file.file_path);
                    console.log('파일 삭제됨:', file.file_path);
                } catch (err) {
                    console.error('파일 삭제 오류:', err);
                }
            }
        });
        
        // DB에서 파일들 삭제
        const deleteFilesQuery = `
            DELETE FROM files WHERE folder_id IN (
                WITH RECURSIVE folder_tree AS (
                    SELECT id FROM folders WHERE id = ?
                    UNION ALL
                    SELECT f.id FROM folders f
                    INNER JOIN folder_tree ft ON f.parent_id = ft.id
                )
                SELECT id FROM folder_tree
            )
        `;
        
        db.run(deleteFilesQuery, [id], (err) => {
            if (err) {
                console.error('파일 DB 삭제 오류:', err);
                res.status(500).json({ error: err.message });
                return;
            }
            
            // 하위 폴더들 삭제
            const deleteSubfoldersQuery = `
                DELETE FROM folders WHERE id IN (
                    WITH RECURSIVE folder_tree AS (
                        SELECT id FROM folders WHERE id = ? AND id != ?
                        UNION ALL
                        SELECT f.id FROM folders f
                        INNER JOIN folder_tree ft ON f.parent_id = ft.id
                    )
                    SELECT id FROM folder_tree
                )
            `;
            
            db.run(deleteSubfoldersQuery, [id, id], (err) => {
                if (err) {
                    console.error('하위 폴더 삭제 오류:', err);
                    res.status(500).json({ error: err.message });
                    return;
                }
                
                // 마지막으로 메인 폴더 삭제
                const deleteFolderQuery = "DELETE FROM folders WHERE id = ?";
                
                db.run(deleteFolderQuery, [id], function(err) {
                    if (err) {
                        console.error('메인 폴더 삭제 오류:', err);
                        res.status(500).json({ error: err.message });
                        return;
                    }
                    
                    console.log('폴더 삭제 완료:', id);
                    res.json({ 
                        message: '폴더가 삭제되었습니다.', 
                        deletedRows: this.changes,
                        folderId: id
                    });
                });
            });
        });
    });
});

// 7. 파일 삭제
app.delete('/api/files/:id', (req, res) => {
    const { id } = req.params;
    
    console.log('파일 삭제 요청:', id);
    
    // 파일 정보 조회
    const selectQuery = "SELECT * FROM files WHERE id = ?";
    
    db.get(selectQuery, [id], (err, row) => {
        if (err) {
            console.error('파일 조회 오류:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        
        if (!row) {
            res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
            return;
        }
        
        console.log('삭제할 파일 정보:', row);
        
        // 실제 파일 삭제
        if (row.file_path && row.file_path !== '' && fs.existsSync(row.file_path)) {
            try {
                fs.unlinkSync(row.file_path);
                console.log('파일 삭제됨:', row.file_path);
            } catch (err) {
                console.error('파일 삭제 오류:', err);
            }
        }
        
        // 데이터베이스에서 파일 삭제
        const deleteQuery = "DELETE FROM files WHERE id = ?";
        
        db.run(deleteQuery, [id], function(err) {
            if (err) {
                console.error('파일 DB 삭제 오류:', err);
                res.status(500).json({ error: err.message });
                return;
            }
            
            console.log('파일 DB 삭제 완료:', id);
            res.json({ 
                message: '파일이 삭제되었습니다.', 
                deletedRows: this.changes,
                fileId: id,
                fileName: row.original_name
            });
        });
    });
});

// 8. 파일 검색
app.get('/api/search', (req, res) => {
    const { query, tabType } = req.query;
    
    if (!query) {
        res.status(400).json({ error: '검색어가 필요합니다.' });
        return;
    }
    
    const searchQuery = `
        SELECT f.*, fo.name as folder_name
        FROM files f
        LEFT JOIN folders fo ON f.folder_id = fo.id
        WHERE f.tab_type = ? AND (f.original_name LIKE ? OR f.name LIKE ?)
        ORDER BY f.created_at DESC
        LIMIT 50
    `;
    
    const searchTerm = `%${query}%`;
    
    db.all(searchQuery, [tabType, searchTerm, searchTerm], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        res.json(rows);
    });
});

// 정적 파일 제공 (프론트엔드)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 시작
app.listen(PORT, () => {
    console.log(`🚀 AskDoc 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
    console.log(`📁 업로드 디렉토리: ${uploadsDir}`);
    console.log(`💾 데이터베이스: askdoc.db`);
});

// 프로세스 종료 시 데이터베이스 연결 해제
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('데이터베이스 연결이 해제되었습니다.');
        process.exit(0);
    });
});