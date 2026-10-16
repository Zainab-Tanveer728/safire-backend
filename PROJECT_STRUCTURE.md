# Project Structure

Current backend folders and files. `.git/` and `node_modules/` are excluded because they contain Git internals and installed dependencies.

```text
safire-backend/
|-- .env
|-- .gitignore
|-- createAdmin.js
|-- GOOGLE_OAUTH_FIX.md
|-- package-lock.json
|-- package.json
|-- passport.js
|-- PROJECT_STRUCTURE.md
|-- PROJECT_SUMMARY.md
|-- seedproject.js
|-- logs/
|-- src/
|   |-- app.js
|   |-- config/
|   |   |-- db.js
|   |   `-- multer.js
|   |-- controllers/
|   |   |-- adminController.js
|   |   |-- aiController.js
|   |   |-- authController.js
|   |   |-- clientController.js
|   |   |-- freelancerAssistanceController.js
|   |   |-- freelancerController.js
|   |   |-- notificationController.js
|   |   |-- profileController.js
|   |   |-- projectController.js
|   |   |-- resumeController.js
|   |   `-- userController.js
|   |-- middleware/
|   |   |-- adminAuth.js
|   |   |-- authMiddleware.js
|   |   |-- errorMiddleware.js
|   |   |-- rateLimiter.js
|   |   `-- validate.js
|   |-- models/
|   |   |-- AdminAuditLog.js
|   |   |-- ClientProfile.js
|   |   |-- ExtractedRequirement.js
|   |   |-- MeetingSession.js
|   |   |-- MeetingTranscript.js
|   |   |-- notification.js
|   |   |-- Project.js
|   |   |-- proposal.js
|   |   |-- RefreshToken.js
|   |   |-- Requirementdocument.js
|   |   |-- Requirementhistory.js
|   |   |-- skillGapReport.js
|   |   `-- User.js
|   |-- routes/
|   |   |-- adminRoutes.js
|   |   |-- aiRoutes.js
|   |   |-- authRoutes.js
|   |   |-- clientRoutes.js
|   |   |-- freelancerRoutes.js
|   |   |-- notificationRoutes.js
|   |   |-- profileRoutes.js
|   |   `-- userRoutes.js
|   |-- services/
|   |   |-- aiService.js
|   |   |-- authService.js
|   |   |-- emailService.js
|   |   |-- githubService.js
|   |   |-- notificationService.js
|   |   `-- userService.js
|   |-- utils/
|   |   |-- apiResponse.js
|   |   |-- AppError.js
|   |   |-- catchAsync.js
|   |   |-- notificationCatalog.js
|   |   `-- userPayload.js
|   `-- validators/
|       |-- authValidators.js
|       |-- clientValidator.js
|       `-- profileValidators.js
`-- uploads/
    |-- avatars/
    |   `-- avatar_69f8c8a69d5a87447628c67d_1777912042760.jpeg
    |-- logos/
    `-- resumes/
        |-- Ayesha_Faryad_CV.docx
        |-- resume_69f339c9261b348da8044de1_1777639267457.docx
        |-- resume_69f339c9261b348da8044de1_1777639290621.docx
        |-- resume_69f339c9261b348da8044de1_1777642194586.docx
        |-- resume_69f72e4eb0c88e71c7136264_1777806962027.pdf
        |-- resume_69f8c8a69d5a87447628c67d_1777912123709.docx
        |-- resume_69f8c8a69d5a87447628c67d_1778264687483.pdf
        |-- resume_69f8c8a69d5a87447628c67d_1778266502070.pdf
        |-- resume_69f997176cf28b4508d30142_1777964875083.docx
        |-- resume_6a012cb47e6e2835d75551a8_1778462005136.docx
        |-- resume_6a04ea646c89282b409e6461_1778708491450.docx
        `-- resume_6a0558a32016e7e7761fa2ff_1791042181433.docx
```
