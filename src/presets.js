// 예시 시나리오. 좌표는 지도 픽셀(700x700) 기준.
// 전술 내용은 커뮤니티 공략(포스타입 "온살 가이드", 6.5 기준)의 설명을 바탕으로 단순화한 예시입니다.

const base = () => ({ b1: 'flames', b10: 'maelstrom', b6: 'adder' });

export const PRESETS = [
  {
    key: 'overview',
    name: '기본 배치 (빈 보드)',
    data: {
      version: 1,
      title: '기본 배치',
      baseTeams: base(),
      steps: [
        {
          title: '시작',
          note: '세 총사령부가 각 본진에서 출발합니다. 시작하면 순결한 땅(노드) 6개가 뜨니, 노드를 클릭해 등급을 표시해 보세요.',
          nodes: {},
          units: [
            { id: 'u1', side: 'b1', kind: 'main', label: '1시 본대', x: 630, y: 70 },
            { id: 'u10', side: 'b10', kind: 'main', label: '10시 본대', x: 55, y: 210 },
            { id: 'u6', side: 'b6', kind: 'main', label: '6시 본대', x: 488, y: 640 },
          ],
          drawings: [],
        },
      ],
    },
  },
  {
    key: 'sand-12u',
    name: '예시: 12상 샌드 (6시가 1시를 친다)',
    data: {
      version: 1,
      title: '12상 샌드 A',
      baseTeams: base(),
      steps: [
        {
          title: '1시 vs 10시 교전',
          note: '12상 A급 노드를 두고 1시·10시 총사가 붙어 있습니다.',
          nodes: { n12u: 'A' },
          units: [
            { id: 'u1', side: 'b1', kind: 'main', label: '1시 본대', x: 428, y: 130 },
            { id: 'u10', side: 'b10', kind: 'main', label: '10시 본대', x: 378, y: 124 },
            { id: 'u6', side: 'b6', kind: 'main', label: '6시 본대', x: 486, y: 262 },
          ],
          drawings: [],
        },
        {
          title: '6시 샌드 진입',
          note: '1시가 빠질 타이밍에 6시 총사가 남쪽에서 올라와 1시 뒤를 칩니다.\n1시 쪽 방어 인원은 X 위치에서 막으면서 샌드 징을 찍어주세요.',
          nodes: { n12u: 'A' },
          units: [
            { id: 'u1', side: 'b1', kind: 'main', label: '1시 본대', x: 432, y: 128 },
            { id: 'u10', side: 'b10', kind: 'main', label: '10시 본대', x: 378, y: 124 },
            { id: 'u6', side: 'b6', kind: 'main', label: '6시 본대', x: 464, y: 186 },
          ],
          drawings: [
            { id: 'd1', type: 'advance', side: 'b6', pts: [[486, 262], [478, 222], [466, 184], [450, 150], [436, 136]] },
            { id: 'd2', type: 'mark', text: 'X', x: 462, y: 168 },
          ],
        },
        {
          title: '1시 퇴각',
          note: '1시는 산개해서 집 쪽 벽에 붙어 빠집니다.\n6시는 역샌드(10시가 돌아서 치는 것)를 조심해서 3시~2언 쪽으로 빠집니다.',
          nodes: { n12u: 'A' },
          units: [
            { id: 'u1', side: 'b1', kind: 'main', label: '1시 본대', x: 486, y: 104 },
            { id: 'u10', side: 'b10', kind: 'main', label: '10시 본대', x: 384, y: 128 },
            { id: 'u6', side: 'b6', kind: 'main', label: '6시 본대', x: 438, y: 138 },
          ],
          drawings: [
            { id: 'd1', type: 'advance', side: 'b6', pts: [[486, 262], [478, 222], [466, 184], [450, 150], [436, 136]] },
            { id: 'd2', type: 'mark', text: 'X', x: 462, y: 168 },
            { id: 'd3', type: 'retreat', side: 'b1', pts: [[432, 126], [458, 114], [486, 104], [516, 96]] },
            { id: 'd4', type: 'retreat', side: 'b6', pts: [[440, 142], [470, 196], [500, 236], [530, 252]] },
          ],
        },
      ],
    },
  },
  {
    key: 'center-burst',
    name: '예시: 센언 언덕 위 버스트',
    data: {
      version: 1,
      title: '센언 버스트',
      baseTeams: base(),
      steps: [
        {
          title: '센언 대치',
          note: '1등인 10시 총사가 센언 위를 잡고 있고, 1시·6시가 아래에서 대치 중입니다.',
          nodes: { nc: 'S' },
          units: [
            { id: 'u10', side: 'b10', kind: 'main', label: '10시 본대', x: 392, y: 300 },
            { id: 'u1', side: 'b1', kind: 'main', label: '1시 본대', x: 462, y: 244 },
            { id: 'u6', side: 'b6', kind: 'main', label: '6시 본대', x: 414, y: 392 },
          ],
          drawings: [],
        },
        {
          title: '6시 선버스트',
          note: '6시 총사가 남쪽 다리로 올라가 10시를 칩니다.\n먼저 들어간 총사 = 노드는 나머지 총사 몫. 1시는 이 틈에 노드를 찍으러 갑니다.',
          nodes: { nc: 'S' },
          units: [
            { id: 'u10', side: 'b10', kind: 'main', label: '10시 본대', x: 388, y: 298 },
            { id: 'u1', side: 'b1', kind: 'small', label: '1시 소수', x: 430, y: 270 },
            { id: 'u1m', side: 'b1', kind: 'main', label: '1시 본대', x: 456, y: 248 },
            { id: 'u6', side: 'b6', kind: 'main', label: '6시 본대', x: 402, y: 318 },
          ],
          drawings: [
            { id: 'c1', type: 'advance', side: 'b6', pts: [[414, 392], [410, 370], [404, 340], [400, 318]] },
            { id: 'c2', type: 'advance', side: 'b1', pts: [[462, 244], [444, 252], [424, 280], [404, 298]] },
          ],
        },
        {
          title: '10시 낙하 후 정비',
          note: '버스트를 맞은 10시는 버티지 말고 언덕 아래로 떨어져서 산개, 집 쪽(9시 방향)으로 빠져 정비합니다.',
          nodes: { nc: 'S' },
          units: [
            { id: 'u10', side: 'b10', kind: 'main', label: '10시 본대', x: 300, y: 296 },
            { id: 'u1', side: 'b1', kind: 'small', label: '1시 소수', x: 398, y: 300 },
            { id: 'u1m', side: 'b1', kind: 'main', label: '1시 본대', x: 446, y: 256 },
            { id: 'u6', side: 'b6', kind: 'main', label: '6시 본대', x: 392, y: 306 },
          ],
          drawings: [
            { id: 'c1', type: 'advance', side: 'b6', pts: [[414, 392], [410, 370], [404, 340], [400, 318]] },
            { id: 'c2', type: 'advance', side: 'b1', pts: [[462, 244], [444, 252], [424, 280], [404, 298]] },
            { id: 'c3', type: 'retreat', side: 'b10', pts: [[384, 296], [360, 300], [330, 300], [300, 296], [262, 286]] },
          ],
        },
      ],
    },
  },
];
