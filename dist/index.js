import { MongoClient, ServerApiVersion } from 'mongodb';
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();
const app = express();
const PORT = process.env.PORT || 8000;
const uri = process.env.MONGODB_URI;
app.use(cors());
app.use(express.json());
if (!uri) {
    throw new Error("Please define the MONGODB_URI environment variable inside your .env file");
}
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
async function run() {
    try {
        const database = client.db("eduplatform_db");
        const coursesCollection = database.collection("courses");
        // --- API Endpoint: Add a new course (POST) ---
        app.post("/api/courses", async (req, res) => {
            try {
                const courseData = req.body;
                if (!courseData.name || !courseData.imgUrl || !courseData.price) {
                    return res.status(400).json({ success: false, message: "Missing required fields." });
                }
                const result = await coursesCollection.insertOne(courseData);
                res.status(251).json({
                    success: true,
                    message: "Course inserted successfully!",
                    insertedId: result.insertedId
                });
            }
            catch (error) {
                res.status(500).json({
                    success: false,
                    message: "Server Database error.",
                    error: error.message
                });
            }
        });
        // --- API Endpoint: Get Courses with Pagination, Search, Filtering & Sorting (GET) ---
        app.get("/api/courses", async (req, res) => {
            try {
                // req.query-কে স্ট্রিং হিসেবে কাস্ট করা হলো টাইপ এরর দূর করার জন্য
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 6;
                const search = req.query.search || "";
                const category = req.query.category || "All";
                const sort = req.query.sort || "default";
                // ডাইনামিক কি-অ্যাসাইনমেন্টের জন্য টাইপ ডিফাইন করা হলো
                let filterQuery = {};
                if (search) {
                    filterQuery.name = { $regex: search, $options: "i" };
                }
                if (category !== "All") {
                    filterQuery.category = category;
                }
                // সর্ট অবজেক্টের জন্য টাইপ ডিফাইন করা হলো
                let sortQuery = {};
                if (sort === "price-low") {
                    sortQuery.price = 1;
                }
                else if (sort === "price-high") {
                    sortQuery.price = -1;
                }
                else if (sort === "rating") {
                    sortQuery.rating = -1;
                }
                else {
                    sortQuery._id = -1;
                }
                const skip = (page - 1) * limit;
                const courses = await coursesCollection.find(filterQuery)
                    .sort(sortQuery)
                    .skip(skip)
                    .limit(limit)
                    .toArray();
                const totalCourses = await coursesCollection.countDocuments(filterQuery);
                const totalPages = Math.ceil(totalCourses / limit);
                res.json({
                    success: true,
                    courses,
                    page,
                    totalPages,
                    totalCourses
                });
            }
            catch (error) {
                res.status(500).json({
                    success: false,
                    message: "Failed to fetch pagination matrix.",
                    error: error.message
                });
            }
        });
        console.log("Successfully connected and integrated MongoDB operations!");
    }
    catch (err) {
        console.error("Database connection failure:", err);
    }
}
// run().catch(console.dir);
app.get("/", (req, res) => {
    res.send("Online Course Server is running...");
});
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
//# sourceMappingURL=index.js.map