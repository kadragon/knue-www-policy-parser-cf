import { describe, it } from 'vitest';
import { formatPolicyAsMarkdown } from '../src/preview/formatter';

describe('Markdown Demo - Single Policy', () => {
  it('should show how a single policy becomes markdown', () => {
    const examplePolicy = {
      title: '한국교원대학교 학칙',
      fileNo: '1345',
      previewUrl: 'https://www.knue.ac.kr/www/contents.do?key=392&fileNo=1345',
      downloadUrl: 'https://www.knue.ac.kr/files/policy/1345.pdf',
      savedAt: '2025-10-19T03:46:20.048Z',
      lastUpdated: '2025-10-19T03:46:20.048Z',
      previewContent: {
        summary: '한국교원대학교의 기본이 되는 학칙으로, 학생의 정원, 입학, 등록, 교과과정, 수강신청, 시험, 성적, 졸업 등 학사 관련 사항을 규정합니다.',
        content: `제1장 총칙
제1조 (목적) 이 학칙은 한국교원대학교의 교육목적을 실현하기 위하여 학교의 조직, 학생의 선발, 입학, 등록, 수강신청, 강의, 시험, 성적, 졸업 등 학사관리에 관하여 필요한 사항을 규정함을 목적으로 한다.

제2조 (정의) 본 학칙에서 사용하는 용어의 정의는 다음과 같다.
1. "학생"이라 함은 본 대학에 입학하여 학적이 있는 자를 말한다.
2. "수강신청"이라 함은 학생이 수강할 과목을 선택하는 행위를 말한다.
3. "학점"이라 함은 과목이수에 대한 평가단위를 말한다.`
      }
    };

    const markdown = formatPolicyAsMarkdown(examplePolicy);
    
    console.log('\n' + '='.repeat(80));
    console.log('📄 Policy Markdown Output Example');
    console.log('='.repeat(80));
    console.log(markdown);
    console.log('='.repeat(80) + '\n');
  });
});
