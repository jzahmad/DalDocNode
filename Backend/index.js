const express = require('express');
const app = express();
const PORT = process.env.PORT || 2000;
const mysql = require('mysql');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

app.use(cors());
app.use(express.json());



const connection = mysql.createConnection({
    host: 'database-2.cfcy44gyo543.us-east-1.rds.amazonaws.com',
    port: '3306',
    user: 'Jazibahmad',
    password: 'Jazibahmad',
    database: 'DalDoc'
});

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL server:', err.stack);
        return;
    }
    console.log('Connected to MySQL server');
});

AWS.config.update({
    region: 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const s3 = new AWS.S3();
const sns = new AWS.SNS();

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    fileFilter: function (req, file, cb) {
        if (!file.originalname.match(/\.(pdf)$/)) {
            return cb(new Error('Only PDF files are allowed!'));
        }
        cb(null, true);
    }
});

app.get('/', (req, res) => {
    res.send('Hello, World!');
});

app.get('/departments', (req, res) => {
    const query = "SELECT name FROM departments";
    connection.query(query, (error, results, fields) => {
        if (error) {
            res.status(500).json({ error: 'Internal server error' });
            return;
        }
        res.json(results);
    });
});

app.post("/courses", (req, res) => {
    const department = req.body.department;
    const query = "SELECT code FROM courses JOIN departments ON courses.department_id = departments.id WHERE departments.name =?";
    connection.query(query, [department], (error, results, fields) => {
        if (error) {
            res.status(500).json({ error: 'Internal server error' });
            return;
        }
        res.json(results);
    });
});

app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No PDF file was uploaded.');
    }

    const filename = `${req.body.course}/${req.body.year}/${req.body.term}/${req.body.documentType}/${req.body.type}`;

    const params = {
        Bucket: 'final-project-4145-bucket',
        Key: `${filename}.pdf`, // Name of the file when uploaded to S3
        Body: req.file.buffer // File content buffer
    };

    try {
        const data = await s3.upload(params).promise();
        res.status(200).send('PDF file uploaded successfully');
    } catch (err) {
        res.status(500).send('Error uploading PDF file');
    }
});


app.post('/pdfs', (req, res) => {
    const { course } = req.body;
    const params = {
        Bucket: 'final-project-4145-bucket',
    };

    s3.listObjectsV2(params, (err, data) => {
        if (err) {
            console.error('Error listing objects:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }

        const pdfFiles = data.Contents.filter(file => file.Key.startsWith(course)
            && file.Key.endsWith('.pdf')).map(file => {
                return {
                    name: file.Key,
                    url: `https://final-project-4145-bucket.s3.amazonaws.com/${file.Key}`
                };
            });
        res.json({ pdfFiles });
    });
});

app.post('/comments', (req, res) => {
    const { department, comment } = req.body;
    const selectQuery = "SELECT id FROM departments WHERE name = ?";

    connection.query(selectQuery, [department], (error, results, fields) => {
        if (error) {
            console.error('Error executing department query:', error);
            return res.status(500).json({ error: 'Database error' });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'Department not found' });
        }

        const departmentId = results[0].id;

        const insertQuery = "INSERT INTO comments (department_id, comment) VALUES (?, ?)";
        const values = [departmentId, comment];

        connection.query(insertQuery, values, (error, results, fields) => {
            if (error) {
                console.error('Error inserting comment:', error);
                return res.status(500).json({ error: 'Database error' });
            }
        });
    });
});

app.get('/getComments', (req, res) => {
    const department = req.query.department;
    const fetchDepartmentIdQuery = "SELECT id FROM departments WHERE name = ?";

    connection.query(fetchDepartmentIdQuery, [department], (error, results, fields) => {
        if (error) {
            console.error('Error fetching department ID:', error);
            return res.status(500).json({ error: 'Database error' });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'Department not found' });
        }

        const departmentId = results[0].id;
        const fetchCommentsQuery = "SELECT comment FROM comments WHERE department_id = ?";

        connection.query(fetchCommentsQuery, [departmentId], (error, results, fields) => {
            if (error) {
                console.error('Error fetching comments:', error);
                return res.status(500).json({ error: 'Database error' });
            }
            res.status(200).json({ results });
        });
    });
});

const JWT_SECRET = 'your_secret_key';


// Login route
// Login route
app.post('/auth/login', (req, res) => {
    const { email, password } = req.body;

    connection.query('SELECT * FROM users WHERE email = ?', [email], (error, results, fields) => {
        if (error) {
            console.error('Error executing login query:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }

        if (results.length === 0) {
            return res.status(401).json({ error: 'Email not found' });
        }

        const user = results[0];

        // Compare passwords directly
        if (password !== user.password) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        // Generate JWT token
        const token = jwt.sign({ email: user.email, id: user.id }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    });
});


// Create account route
app.post('/create', async (req, res) => {
    const admin = "jz346475@dal.ca";
    const email = req.body.email;
    console.log(email);

    try {
        // Check if email already exists in the database
        const checkQuery = "SELECT COUNT(*) AS count FROM users WHERE email = ?";
        const checkValues = [email];

        connection.query(checkQuery, checkValues, async (error, results, fields) => {
            if (error) {
                console.error('Error checking email existence:', error);
                return res.status(500).json({ error: 'Database error' });
            }

            const emailExists = results[0].count > 0;

            if (emailExists) {
                return res.status(201).json({ message: 'Email already exists' });
            }

            // Generate random password
            const randomString = Math.random().toString(36).substring(2, 12);
            // Hash the random string
            const hashedPassword = await bcrypt.hash(randomString, 10);

            // Insert the user into the database
            const insertQuery = "INSERT INTO users (email, password) VALUES (?, ?)";
            const insertValues = [email, hashedPassword];

            connection.query(insertQuery, insertValues, (insertError, insertResults, insertFields) => {
                if (insertError) {
                    console.error('Error creating account:', insertError);
                    return res.status(500).json({ error: 'Database error' });
                }
                return res.status(201).json({ message: `Your Password is: ${hashedPassword}`});
            });
        });
    } catch (error) {
        console.error('Error generating or hashing password:', error);
        return res.status(500).json({ error: 'Password generation error' });
    }
});


app.post("/addDepartment", (req, res) => {
    const admin = "jz346475@dal.ca";
    const department = req.body.department;

    const checkQuery = "SELECT id FROM departments WHERE name = ?";
    connection.query(checkQuery, [department], (error, results, fields) => {
        if (error) {
            console.error('Error checking department:', error);
            return res.status(500).json({ message: 'Database error' });
        }

        // If department already exists, return error
        if (results.length > 0) {
            return res.status(201).json({ message: 'Department already exists' });
        }

        // Send email to admin
        sendEmailForAddition(`Add the following department: ${department}`, res);
    });
});

app.post("/addFac", (req, res) => {
    const admin = "jz346475@dal.ca";
    const course = req.body.course;

    const checkQuery = "SELECT id FROM courses WHERE code = ?";
    connection.query(checkQuery, [course], (error, results, fields) => {
        if (error) {
            console.error('Error checking course:', error);
            return res.status(500).json({ message: 'Database error' });
        }

        // If department already exists, return error
        if (results.length > 0) {
            return res.status(201).json({ message: 'Course already exists' });
        }

        sendEmailForAddition(`Add the following course: ${course}`, res);
    });
});




// Function to send email for department addition using Amazon SNS
function sendEmailForAddition(message, res) {
    const params = {
        Message: message,
        TopicArn: "arn:aws:sns:us-east-1:767397661521:SQSEmails"
    };
    sns.publish(params, function (err, data) {
        if (err) {
            console.log("Error publishing message", err);
            return res.status(500).json({ message: 'Failed to publish message' });
        } else {
            console.log("Message published successfully");
            return res.status(200).json({ message: 'Message published successfully' });
        }
    });
}



// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
