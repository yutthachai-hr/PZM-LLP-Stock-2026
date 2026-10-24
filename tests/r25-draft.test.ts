import { expect, test } from 'vitest'
import { draftIsEmpty, emptyDraft, restoreReceipt } from '../src/pages/receive/receipt'
const row={draftId:'draft-a',parentId:'parent',name:'Anchor Cream Cheese',spec:'200 g',qty:5,unit:'Pack',expectedBaseQty:5}
test('experimental draft restore keeps three real rows rather than collapsing category identity',()=>{
 const rows=[row,{...row,draftId:'draft-b',name:'Unsalted Butter'},{...row,draftId:'draft-c',name:'Cream Cheese Trial B'}]
 const restored=restoreReceipt({...emptyDraft(),mode:'manual',experimental:rows,experimentalOperationId:'11111111-1111-4111-8111-111111111111'})
 expect(restored).toMatchObject({experimental:rows,experimentalOperationId:'11111111-1111-4111-8111-111111111111'})
})
test('experimental rows alone keep the receiving draft nonempty',()=>{
 expect(draftIsEmpty({...emptyDraft(),experimental:[row]})).toBe(false)
})
