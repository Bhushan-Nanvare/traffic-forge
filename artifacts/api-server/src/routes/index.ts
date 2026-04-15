import { Router, type IRouter } from "express";
import healthRouter from "../features/health/router";
import trafficforgeRouter from "../features/trafficforge/router";

const router: IRouter = Router();

router.use(healthRouter);
router.use(trafficforgeRouter);

export default router;
