import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import revisionRouter from "./revision";
import todosRouter from "./todos";
import storageRouter from "./storage";
import photosRouter from "./photos";
import bookmarksRouter from "./bookmarks";
import notebooksRouter from "./notebooks";
import flashcardsRouter from "./flashcards";
import syncRouter from "./sync";
import emailRouter from "./email";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(revisionRouter);
router.use(todosRouter);
router.use(storageRouter);
router.use(photosRouter);
router.use(bookmarksRouter);
router.use(notebooksRouter);
router.use(flashcardsRouter);
router.use(syncRouter);
router.use(emailRouter);

export default router;
