import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from importlib.machinery import SourceFileLoader
mod=SourceFileLoader("exam_import",str(Path(__file__).resolve().parents[1]/"import.py")).load_module()

class ImportTests(unittest.TestCase):
    def test_metadata_case_insensitive(self):
        m=mod.metadata(Path("MALLORCA_1T_PER_D_respostes.pdf"),"")
        self.assertEqual((m["island"],m["license"]),("Mallorca","PER"))
        self.assertTrue(m["corrected"])
    def test_unknown_year_is_not_invented(self):
        self.assertIsNone(mod.metadata(Path("Menorca_PY_res.pdf"),"")["year"])
    def test_cr_folder_maps_to_app_license_cy(self):
        m=mod.metadata(Path("Ibiza/2024/CR/examen.pdf"),"")
        self.assertEqual((m["island"],m["year"],m["license"]),("Ibiza",2024,"CY"))
    def test_session_from_folder_and_catalan_pdf_header(self):
        m=mod.metadata(Path("Mallorca/2017/septiembre/PER/examen.pdf"),"Convocatòria: Setembre 2017")
        self.assertEqual(m["session"],"septiembre")
    def test_combined_islands_and_models_are_left_unknown(self):
        m=mod.metadata(Path("desorden/2021/marzo/01_Capita_de_Iot_model_A_y_C_Eivissa_Menorca.pdf"),"Examen: prova teórica capità de iot")
        self.assertIsNone(m["island"])
        self.assertEqual(m["license"],"CY")
        self.assertIsNone(m["model"])
    def test_question_and_no_inferred_answer(self):
        q=mod.split_questions("6. ¿Qué rumbo?\nA: Norte\nB: Sur\nC: Este\nD: Oeste")[0]
        self.assertEqual(len(q["options"]),4)
        self.assertIsNone(q["answer"])
        self.assertEqual(q["status"],"PENDING_REVIEW")
    def test_explicit_official_answer_is_extracted(self):
        q=mod.split_questions("6. ¿Qué rumbo?\nA: Norte\nB: Sur\nC: Este\nD: Oeste\nResposta correcta: D")[0]
        self.assertEqual(q["answer"],"D")
        self.assertEqual(q["answerSource"],"OFFICIAL_PDF")
        self.assertEqual(q["options"]["D"],"Oeste")
        self.assertEqual(q["status"],"PENDING_REVIEW")
    def test_question_and_answer_can_cross_page_boundary(self):
        p1="41. ¿Cuál será la declinación?\nA: 6° 54' E\nB: 5° 47' E\n"
        p2="C: 3° 17' E\nD: 1° 46' E\nResposta correcta: A\n\n42. Otra pregunta\nA: Sí\nB: No\n"
        offsets=[(0,len(p1)),(len(p1)+1,len(p1)+1+len(p2))]
        qs=mod.split_questions(p1+"\n"+p2,offsets)
        self.assertEqual(qs[0]["answer"],"A")
        self.assertEqual(qs[0]["options"]["A"],"6° 54' E")
        self.assertEqual((qs[0]["startPage"],qs[0]["endPage"]),(1,2))
    def test_conflicting_official_answers_stay_unresolved(self):
        q=mod.split_questions("1. Pregunta\nA: Uno\nB: Dos\nResposta correcta: A\nRespuesta correcta: B")[0]
        self.assertIsNone(q["answer"])
        self.assertTrue(any("contradictorias" in w for w in q["warnings"]))

if __name__=="__main__": unittest.main()
