import { MongoClient, ServerApiVersion, ObjectId } from 'mongodb';
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
    const enrollmentsCollection = database.collection("enrollments"); // 💡 গ্লোবাল ডিক্লেয়ারেশন যাতে সব এন্ডপয়েন্ট অ্যাক্সেস করতে পারে

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
      } catch (error) {
        res.status(500).json({
          success: false,
          message: "Server Database error.",
          error: (error as any).message
        });
      }
    });

    // --- API Endpoint: Get Courses with Pagination, Search, Filtering & Sorting (GET) ---
    app.get("/api/courses", async (req, res) => {
      try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 6;
        const search = (req.query.search as string) || "";
        const category = (req.query.category as string) || "All";
        const sort = (req.query.sort as string) || "default";

        let filterQuery: Record<string, any> = {};

        if (search) {
          filterQuery.name = { $regex: search, $options: "i" };
        }

        if (category !== "All") {
          filterQuery.category = category;
        }

        let sortQuery: Record<string, any> = {};
        if (sort === "price-low") {
          sortQuery.price = 1;
        } else if (sort === "price-high") {
          sortQuery.price = -1;
        } else if (sort === "rating") {
          sortQuery.rating = -1;
        } else {
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

      } catch (error) {
        res.status(500).json({
          success: false,
          message: "Failed to fetch pagination matrix.",
          error: (error as any).message
        });
      }
    });

    // --- API Endpoint: Get Single Course Details by ID (GET) ---
    app.get("/api/courses/:id", async (req, res) => {
      try {
        const courseId = req.params.id;

        if (!ObjectId.isValid(courseId)) {
          return res.status(400).json({ success: false, message: "Invalid Course ID structure." });
        }

        const course = await coursesCollection.findOne({ _id: new ObjectId(courseId) });

        if (!course) {
          return res.status(404).json({ success: false, message: "Course not found." });
        }

        if (!course.interactions) {
          course.interactions = {
            likes: 0,
            dislikes: 0,
            love: 0,
            reports: 0,
            comments: []
          };
        }

        res.json({ success: true, course });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: "Server error fetching course details.",
          error: (error as any).message
        });
      }
    });

    app.get("/api/mentor/courses", async (req, res) => {
      try {
        const mentorEmail = req.query.email;
        if (!mentorEmail) {
          return res.status(400).json({ success: false, message: "Mentor Email parameter is required." });
        }

        // ডাটাবেজ থেকে শুধুমাত্র এই মেন্টরের অ্যাড করা কোর্স তুলে নিয়ে আসবে
        const courses = await coursesCollection.find({ mentorEmail: mentorEmail }).toArray();
        res.json({ success: true, courses });
      } catch (error) {
        res.status(500).json({ success: false, message: "Server failed to resolve courses matrix.", error: (error as any).message });
      }
    });

    // ⚡ ২. আপনার দেওয়া এক্সিস্টিং ইন্টারঅ্যাকশন প্যাচ রুট (যা ফ্রন্টএন্ডের মডালের ডেটা স্ট্রাকচার নিয়ন্ত্রণ করছে)
  // ⚡ আপডেটেড ইন্টারঅ্যাকশন রাউট (যা ইউজার ট্র্যাকিং হ্যান্ডেল করবে)
    app.patch("/api/courses/:id/interaction", async (req, res) => {
      try {
        const courseId = req.params.id;
        const { type, payload } = req.body; // payload এর ভেতর এখন email এবং username আসবে

        if (!ObjectId.isValid(courseId)) {
          return res.status(400).json({ success: false, message: "Invalid Course ID." });
        }

        let updateQuery: Record<string, any> = {};

        // 💡 লাইক এবং লাভের সাথে ইউজার ট্র্যাকিং অ্যারে যোগ করা হয়েছে ($addToSet ব্যবহার করে যাতে ডুপ্লিকেট না হয়)
        if (type === "like") {
          updateQuery = { 
            $inc: { "interactions.likes": 1 },
            $addToSet: { "interactions.likedBy": payload?.email || "Anonymous" }
          };
        }
        if (type === "love") {
          updateQuery = { 
            $inc: { "interactions.love": 1 },
            $addToSet: { "interactions.lovedBy": payload?.email || "Anonymous" }
          };
        }
        if (type === "dislike") updateQuery = { $inc: { "interactions.dislikes": 1 } };
        if (type === "report") updateQuery = { $inc: { "interactions.reports": 1 } };

        if (type === "comment") {
          const newComment = {
            id: new ObjectId().toString(),
            username: payload?.username || "Anonymous Student",
            text: payload?.text,
            createdAt: new Date()
          };
          updateQuery = { $push: { "interactions.comments": newComment } };
        }

        if (type === "feedback") {
          updateQuery = {
            $push: { "interactions.feedbacks": { rating: parseFloat(payload?.rating), user: payload?.username } }
          };
        }

        const result = await coursesCollection.updateOne(
          { _id: new ObjectId(courseId) },
          updateQuery,
          { upsert: true }
        );

        res.json({ success: true, message: "Interaction tracked successfully!", result });
      } catch (error) {
        res.status(500).json({ success: false, message: "Failed to process interaction.", error: (error as any).message });
      }
    });

    // --- API Endpoint: Update an Existing Course (PUT) ---
    app.put("/api/courses/:id", async (req, res) => {
      try {
        const courseId = req.params.id;
        const updatedData = req.body;

        if (!ObjectId.isValid(courseId)) {
          return res.status(400).json({ success: false, message: "Invalid Course ID structure." });
        }

        const { _id, ...dataToUpdate } = updatedData;

        if (dataToUpdate.price !== undefined) dataToUpdate.price = parseFloat(dataToUpdate.price) || 0;
        if (dataToUpdate.rating !== undefined) dataToUpdate.rating = parseFloat(dataToUpdate.rating) || 5.0;

        const result = await coursesCollection.updateOne(
          { _id: new ObjectId(courseId) },
          { $set: dataToUpdate }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ success: false, message: "Course not found to update." });
        }

        res.json({ success: true, message: "Course updated successfully!" });
      } catch (error) {
        res.status(500).json({ success: false, message: "Server error during update.", error: (error as any).message });
      }
    });

    // --- API Endpoint: Delete a Course (DELETE) ---
    app.delete("/api/courses/:id", async (req, res) => {
      try {
        const courseId = req.params.id;

        if (!ObjectId.isValid(courseId)) {
          return res.status(400).json({ success: false, message: "Invalid Course ID structure." });
        }

        const result = await coursesCollection.deleteOne({ _id: new ObjectId(courseId) });

        if (result.deletedCount === 0) {
          return res.status(404).json({ success: false, message: "Course not found to delete." });
        }

        res.json({ success: true, message: "Course deleted successfully from workspace matrix!" });
      } catch (error) {
        res.status(500).json({ success: false, message: "Server error during deletion.", error: (error as any).message });
      }
    });

    // --- API Endpoint: Enroll in a Course (POST) ---
    app.post("/api/enrollments", async (req, res) => {
      try {
        const { courseId, userEmail, userName, mentorEmail } = req.body;

        if (userEmail === mentorEmail) {
          return res.status(400).json({
            success: false,
            message: "Security Policy: You cannot enroll in your own course workspace."
          });
        }

        const alreadyEnrolled = await enrollmentsCollection.findOne({ courseId, userEmail });
        if (alreadyEnrolled) {
          return res.status(400).json({
            success: false,
            message: "You are already enrolled in this workspace matrix."
          });
        }

        const enrollmentData = {
          courseId,
          userEmail,
          userName,
          mentorEmail,
          enrolledAt: new Date()
        };

        const result = await enrollmentsCollection.insertOne(enrollmentData);

        res.status(201).json({
          success: true,
          message: "Enrollment matrix updated successfully!",
          insertedId: result.insertedId
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: "Enrollment processing failed.",
          error: (error as any).message
        });
      }
    });

    // --- API Endpoint: Check if User is Already Enrolled (GET) ---
    app.get("/api/enrollments/check", async (req, res) => {
      try {
        const { courseId, userEmail } = req.query;

        if (!courseId || !userEmail) {
          return res.status(400).json({ success: false, message: "Missing query parameters." });
        }

        const isEnrolled = await enrollmentsCollection.findOne({
          courseId: courseId.toString(),
          userEmail: userEmail.toString()
        });

        res.json({ success: true, enrolled: !!isEnrolled });
      } catch (error) {
        res.status(500).json({ success: false, message: "Server error checking status." });
      }
    });

    // --- API Endpoint: Get Enrollment History (GET) ---
    // --- API Endpoint: Get Enrollment History for BOTH Mentor & Student (GET) ---
    app.get("/api/enrollments", async (req, res) => {
      try {
        const { mentorEmail, userEmail } = req.query;

        let filterQuery: Record<string, any> = {};

        // ডাইনামিক ফিল্টারিং: মেন্টর নাকি স্টুডেন্ট রিকোয়েস্ট পাঠিয়েছে তা চেক করা
        if (mentorEmail) {
          filterQuery.mentorEmail = mentorEmail as string;
        } else if (userEmail) {
          filterQuery.userEmail = userEmail as string;
        } else {
          return res.status(400).json({ success: false, message: "Missing mentorEmail or userEmail parameters." });
        }

        const enrollmentsCollection = database.collection("enrollments");

        const history = await enrollmentsCollection
          .find(filterQuery)
          .sort({ enrolledAt: -1 })
          .toArray();

        res.json({
          success: true,
          history
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: "Server error fetching enrollment logs.",
          error: (error as any).message
        });
      }
    });

    // --- API Endpoint: Get Student's Enrolled Courses with Pagination (GET) ---
    app.get("/api/student/my-courses", async (req, res) => {
      try {
        const { email, page, limit } = req.query;

        if (!email) {
          return res.status(400).json({ success: false, message: "Student Email parameter is required." });
        }

        const currentPage = parseInt(page as string) || 1;
        const currentLimit = parseInt(limit as string) || 6;
        const skip = (currentPage - 1) * currentLimit;

        // ১. প্রথমে স্টুডেন্টের টোটাল এনরোলমেন্ট কাউন্ট করা
        const totalEnrolled = await database.collection("enrollments").countDocuments({ userEmail: email.toString() });

        // ২. মঙ্গোডিবি এগ্রিগেশন ব্যবহার করে এনরোলমেন্ট ডাটার সাথে কোর্সের মেইন ডাটা মার্জ করা
        const enrolledCourses = await database.collection("enrollments").aggregate([
          { $match: { userEmail: email.toString() } },
          { $sort: { enrolledAt: -1 } },
          { $skip: skip },
          { $limit: currentLimit },
          {
            $addFields: {
              // courseId যদি স্ট্রিং হিসেবে সেভ হয়ে থাকে, তবে তা ম্যাচ করানোর জন্য কনভার্ট করা
              convertedCourseId: {
                $cond: {
                  if: { $toObjectId: "$courseId" },
                  then: { $toObjectId: "$courseId" },
                  else: "$courseId"
                }
              }
            }
          },
          {
            $lookup: {
              from: "courses",
              localField: "convertedCourseId",
              foreignField: "_id",
              as: "courseDetails"
            }
          },
          { $unwind: { path: "$courseDetails", preserveNullAndEmptyArrays: false } }
        ]).toArray();

        // ৩. রেসপন্স ফরম্যাট ক্লিন করা
        const courses = enrolledCourses.map(item => ({
          enrollmentId: item._id,
          enrolledAt: item.enrolledAt,
          ...item.courseDetails
        }));

        const totalPages = Math.ceil(totalEnrolled / currentLimit);

        res.json({
          success: true,
          courses,
          page: currentPage,
          totalPages,
          totalCourses: totalEnrolled
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          message: "Failed to resolve student course matrix.",
          error: (error as any).message
        });
      }
    });
    // --- API Endpoint: Get Student's Liked/Loved (Saved) Courses (GET) ---
    app.get("/api/student/saved-courses", async (req, res) => {
      try {
        const { email, username } = req.query;

        if (!email) {
          return res.status(400).json({ success: false, message: "User Email parameter is required." });
        }

        // 🔒 মঙ্গোডিবি কুয়েরি:interactions অবজেক্টের ভেতর যদি স্টুডেন্ট লাভ বা লাইক দিয়ে থাকে
        // অথবা আপনার ডাটাবেজ আর্কিটেকচার অনুযায়ী ফিল্টার করার জন্য ডাইনামিক কুয়েরি
        const savedCourses = await database.collection("courses").find({
          $or: [
            { "interactions.comments.username": username ? username.toString() : "" },
            // যদি ফিউচারে interactions এর ভেতর আলাদা ইউজার ট্র্যাকিং অ্যারে থাকে তার জন্য ব্যাকআপ লজিক:
            { "interactions.likedBy": email.toString() },
            { "interactions.lovedBy": email.toString() }
          ]
        }).toArray();

        res.json({
          success: true,
          courses: savedCourses
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          message: "Failed to resolve saved course array.",
          error: (error as any).message
        });
      }
    });

    console.log("Successfully connected and integrated MongoDB operations!");
  } catch (err) {
    console.error("Database connection failure:", err);
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Online Course Server is running...");
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});