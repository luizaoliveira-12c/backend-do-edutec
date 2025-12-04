import express from "express";
import cors from "cors";
import mysql2 from "mysql2";

// --- Configuração do Ambiente e Aplicação ---

// Variáveis de ambiente
const { DB_HOST, DB_NAME, DB_USER, DB_PASSWORD } = process.env;

const app = express();

// Configuração do CORS
const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'PUT'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions)); 
app.use(express.json());

// --- Inicialização do Banco de Dados ---

const database = mysql2.createPool({
    host: DB_HOST,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    connectionLimit: 10
});

// Testar a conexão no startup (para logar o erro no Vercel)
database.getConnection((err, connection) => {
    if (err) {
        // ESSA MENSAGEM VOCÊ DEVE PROCURAR NOS LOGS DO VERCEL SE O 500 PERSISTIR.
        console.error('*** ❌ ERRO FATAL: FALHA NA CONEXÃO COM O BANCO DE DADOS ***');
        console.error('Verifique as variáveis de ambiente e o firewall do seu DB.', err);
    } else {
        console.log('✅ Conexão com o banco de dados MySQL estabelecida com sucesso.');
        connection.release();
    }
});


// --- MIDDLEWARE ROBUSTO (IMUNIDADE A ERROS DE DB) ---
/**
 * Se a conexão falhar, retorna 503 Service Unavailable em JSON
 */
const checkDbConnection = (req, res, next) => {
    database.getConnection((err, connection) => {
        if (err) {
            console.error(`Falha ao obter conexão para a rota ${req.path}:`, err);
            // Retorna JSON 503 claro, evitando o 500 HTML.
            return res.status(503).json({ 
                message: "Serviço indisponível. Falha na conexão com o banco de dados. Verifique a infraestrutura (Vercel/MySQL)." 
            });
        }
        connection.release();
        next();
    });
};

// Aplica o middleware a todas as rotas que dependem do DB
app.use(checkDbConnection);


// --- Definição das Rotas da API ---

app.get("/", (request, response) => {
    const selectCommand = "SELECT name, email, score FROM luizarocha_02mb ORDER BY score DESC";
    database.query(selectCommand, (error, users) => {
        if (error) {
            console.error("Erro na consulta GET /:", error);
            return response.status(500).json({ message: "Erro ao buscar usuários no banco de dados." }); 
        }
        response.json(users);
    });
});

app.post("/login", (request, response) => {
    const { email, password } = request.body.user || {}; 
    if (!email || !password) {
        return response.status(400).json({ message: "Email e senha são obrigatórios." });
    }
    const selectCommand = "SELECT id, name, password, score FROM luizarocha_02mb WHERE email = ?";
    database.query(selectCommand, [email], (error, user) => {
        if (error) {
            console.error("Erro na consulta POST /login:", error);
            return response.status(500).json({ message: "Erro interno do servidor." });
        }
        if (user.length === 0 || user[0].password !== password) {
            return response.status(401).json({ message: "Usuário ou senha incorretos!" });
        }
        response.json({ id: user[0].id, name: user[0].name, score: user[0].score });
    });
});

/**
 * Rota POST /cadastrar - Rota crítica
 */
app.post("/cadastrar", (request, response) => {
    const { user } = request.body || {};
    
    if (!user || !user.name || !user.email || !user.password) {
        return response.status(400).json({ message: "Dados de usuário incompletos na requisição." });
    }
    
    const insertCommand = `
        INSERT INTO luizarocha_02mb(name, email, password, score)
        VALUES (?, ?, ?, 0) 
    `;

    database.query(insertCommand, [user.name, user.email, user.password], (error) => {
        if (error) {
            console.error("Erro na consulta POST /cadastrar:", error);
            // O erro mais comum aqui é e-mail duplicado (409)
            return response.status(409).json({ message: "Erro ao cadastrar. O e-mail pode já estar em uso." });
        }
        response.status(201).json({ message: "Usuário cadastrado com sucesso!" });
    });
});

app.post('/update-score', (request, response) => {
    const { email, newScore: scoreData } = request.body;
    const newScore = Number(scoreData); 

    if (!email || typeof newScore !== 'number' || isNaN(newScore)) {
        return response.status(400).json({ message: 'Dados inválidos.' });
    }
    const updateCommand = 'UPDATE luizarocha_02mb SET score = ? WHERE email = ?';
    
    database.query(updateCommand, [newScore, email], (updateError, result) => {
        if (updateError) {
            console.error('Erro ao executar UPDATE score:', updateError);
            return response.status(500).json({ message: 'Erro interno ao salvar pontuação.' });
        }
        if (result && result.affectedRows === 0) {
            return response.status(404).json({ message: 'Usuário não encontrado.' });
        }
        return response.status(200).json({ message: 'Pontuação final salva com sucesso!', finalScore: newScore });
    });
});

// --- Exportação para o Vercel ---
export default app;