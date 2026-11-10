// 예시 시나리오. 좌표는 지도 픽셀(700x700) 기준.
// unit.trail = 이 단계에서 핀이 지나온 길 (마지막 지점은 unit.x, unit.y)
// 전술 내용은 커뮤니티 공략(포스타입 "온살 가이드", 6.5 기준)의 설명을 바탕으로 단순화한 예시입니다.

const base = () => ({ b1: 'flames', b10: 'maelstrom', b6: 'adder' });

const startUnits = () => [
  { id: 'u1', side: 'b1', kind: 'main', label: '1시 본대', x: 628, y: 72 },
  { id: 'u1s', side: 'b1', kind: 'small', label: '1시 소수', x: 610, y: 92 },
  { id: 'u10', side: 'b10', kind: 'main', label: '10시 본대', x: 58, y: 212 },
  { id: 'u10s', side: 'b10', kind: 'small', label: '10시 소수', x: 72, y: 236 },
  { id: 'u6', side: 'b6', kind: 'main', label: '6시 본대', x: 488, y: 638 },
  { id: 'u6s', side: 'b6', kind: 'small', label: '6시 소수', x: 466, y: 624 },
];

export const PRESETS = [
  {
    key: 'overview',
    name: '기본 배치 (빈 보드)',
    data: {
      version: 2,
      title: '기본 배치',
      baseTeams: base(),
      steps: [
        {
          title: '시작 배치',
          note: '세 총사령부가 각 본진에서 출발합니다.\n핀을 잡고 끌어서 옮겨보세요. 지나간 길이 화살표로 남아요.',
          nodes: {},
          units: startUnits(),
          drawings: [],
        },
      ],
    },
  },
  {
    key: 'sand-12u',
    name: '예시: 12상 샌드 (6시가 1시를 친다)',
    data: {
      version: 2,
      title: '12상 샌드 A',
      baseTeams: base(),
      steps: [
        {
          title: '1시 vs 10시 교전',
          note: '12상 A급 노드를 두고 1시·10시 총사가 붙어 있습니다. 6시는 남쪽에서 상황을 보고 있습니다.',
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
            { id: 'u1', side: 'b1', kind: 'main', label: '1시 본대', x: 430, y: 128 },
            { id: 'u10', side: 'b10', kind: 'main', label: '10시 본대', x: 378, y: 124 },
            { id: 'u6', side: 'b6', kind: 'main', label: '6시 본대', x: 440, y: 140, trail: [[486, 262], [480, 226], [468, 190], [454, 158]] },
          ],
          drawings: [{ id: 'd2', type: 'mark', text: 'X', x: 462, y: 168 }],
        },
        {
          title: '1시 퇴각, 6시 이탈',
          note: '1시는 산개해서 집 쪽 벽에 붙어 빠집니다.\n6시는 역샌드(10시가 돌아서 치는 것)를 조심해서 3시~2언 쪽으로 빠집니다.',
          nodes: { n12u: 'A' },
          units: [
            { id: 'u1', side: 'b1', kind: 'main', label: '1시 본대', x: 512, y: 98, trail: [[430, 128], [456, 116], [484, 104]] },
            { id: 'u10', side: 'b10', kind: 'main', label: '10시 본대', x: 396, y: 132, trail: [[378, 124], [388, 130]] },
            { id: 'u6', side: 'b6', kind: 'main', label: '6시 본대', x: 528, y: 250, trail: [[440, 140], [462, 180], [486, 216], [508, 240]] },
          ],
          drawings: [{ id: 'd2', type: 'mark', text: 'X', x: 462, y: 168 }],
        },
      ],
    },
  },
  {
    key: 'center-burst',
    name: '예시: 센언 언덕 위 버스트',
    data: {
      version: 2,
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
          note: '6시 총사가 남쪽 다리로 올라가 10시를 칩니다.\n먼저 들어간 총사 = 노드는 나머지 총사 몫. 1시는 소수를 보내 노드를 찍습니다.',
          nodes: { nc: 'S' },
          units: [
            { id: 'u10', side: 'b10', kind: 'main', label: '10시 본대', x: 388, y: 298 },
            { id: 'u1', side: 'b1', kind: 'main', label: '1시 본대', x: 456, y: 248 },
            { id: 'u1s', side: 'b1', kind: 'small', label: '1시 소수', x: 410, y: 292, trail: [[458, 246], [444, 252], [426, 278]] },
            { id: 'u6', side: 'b6', kind: 'main', label: '6시 본대', x: 400, y: 316, trail: [[414, 392], [410, 368], [404, 340]] },
          ],
          drawings: [],
        },
        {
          title: '10시 낙하 후 정비',
          note: '버스트를 맞은 10시는 버티지 말고 언덕 아래로 떨어져서 산개, 집 쪽(9시 방향)으로 빠져 정비합니다.',
          nodes: { nc: 'S' },
          units: [
            { id: 'u10', side: 'b10', kind: 'main', label: '10시 본대', x: 262, y: 286, trail: [[388, 298], [360, 300], [330, 300], [300, 296]] },
            { id: 'u1', side: 'b1', kind: 'main', label: '1시 본대', x: 446, y: 256 },
            { id: 'u1s', side: 'b1', kind: 'small', label: '1시 소수', x: 398, y: 300, trail: [[410, 292], [404, 296]] },
            { id: 'u6', side: 'b6', kind: 'main', label: '6시 본대', x: 392, y: 306, trail: [[400, 316], [396, 310]] },
          ],
          drawings: [],
        },
      ],
    },
  },
];
