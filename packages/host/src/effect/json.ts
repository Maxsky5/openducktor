import { z, type JSONType } from "zod";

export const parseJson = (payload: string): JSONType => z.json().parse(JSON.parse(payload));
