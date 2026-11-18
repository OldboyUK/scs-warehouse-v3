import "@netlify/database";
import { withLambda } from "@netlify/aws-lambda-compat";
import handlers from "../lib/scheduleHandlers.js";

export default withLambda(handlers.year);
