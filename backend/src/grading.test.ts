import { describe, expect, it } from "vitest";
import { grade } from "./grading";
describe("server grading",()=>{
 it("counts unanswered questions as incorrect",()=>expect(grade([{id:"1",answer:"A"},{id:"2",answer:"B"}],{"1":"A"})).toEqual({correct:1,total:2,score:50}));
 it("returns zero for an empty session",()=>expect(grade([],{}).score).toBe(0));
});
