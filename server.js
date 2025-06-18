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