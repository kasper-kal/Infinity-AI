import { Router, type IRouter } from "express";
import healthRouter from "./health";
import infinityRouter from "./infinity";
import filesRouter from "./files";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/infinity", infinityRouter);
router.use("/files", filesRouter);

export default router;
