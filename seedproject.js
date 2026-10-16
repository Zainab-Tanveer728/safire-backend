// seedProject.js  (put in safire-backend root, next to createAdmin.js)
// Creates ONE test project linking an existing client and an existing freelancer.
//
// Run:  node seedProject.js client@email.com freelancer@email.com
// (both accounts must already exist: register them on the site first)

try { require("@dotenvx/dotenvx").config(); } catch { try { require("dotenv").config(); } catch {} }

const mongoose = require("mongoose");
const User     = require("./src/models/User");
const Project  = require("./src/models/Project");

const URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URI;
const [clientEmail, freelancerEmail] = process.argv.slice(2).map((e) => (e || "").trim().toLowerCase());

if (!URI) { console.error("❌  No MongoDB URI found in .env"); process.exit(1); }
if (!clientEmail || !freelancerEmail) {
  console.error("❌  Usage: node seedProject.js client@email.com freelancer@email.com");
  process.exit(1);
}

(async () => {
  await mongoose.connect(URI);

  const client     = await User.findOne({ email: clientEmail,     role: "client" });
  const freelancer = await User.findOne({ email: freelancerEmail, role: "freelancer" });

  if (!client)     { console.error(`❌  No CLIENT account with email ${clientEmail}`);         process.exit(1); }
  if (!freelancer) { console.error(`❌  No FREELANCER account with email ${freelancerEmail}`); process.exit(1); }

  const title = "Online Shop Website (test project)";
  let project = await Project.findOne({ client: client._id, freelancer: freelancer._id, title });

  if (project) {
    console.log("⚠️   This test project already exists, reusing it.");
  } else {
    project = await Project.create({
      client:      client._id,
      freelancer:  freelancer._id,
      title,
      description: "A website where customers browse products, add them to a cart and pay online. " +
                   "The client also wants an admin page to manage products and orders.",
      skills:      ["React.js", "Node.js", "UI/UX Design", "Payment API"],
      status:      "active",
      startDate:   new Date(),
      deadline:    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      budget:      1500,
      currency:    "USD",
    });
    console.log("✅  Test project created.");
  }

  console.log("──────────────────────────────────────");
  console.log("   Project ID :", project._id.toString());
  console.log("   Client     :", client.email);
  console.log("   Freelancer :", freelancer.email);
  console.log("   Open page  : /freelancer/project/" + project._id);
  console.log("──────────────────────────────────────");

  await mongoose.disconnect();
})().catch((err) => { console.error("❌  Seed failed:", err.message); process.exit(1); });