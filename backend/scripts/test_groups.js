async function testGroups() {
  const signInRes = await fetch('http://localhost:3000/api/auth/sign-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'rose.fo@thenearbuy.com', password: '12345678@@@@' })
  });
  const session = await signInRes.json();
  console.log('SIGNED IN:', session.user?.email, 'COMPANY:', session.company?.name, 'ID:', session.company?.id);

  const groupsRes = await fetch('http://localhost:3000/api/crm/lead-groups', {
    headers: { 'Authorization': `Bearer ${session.token}` }
  });
  const groupsData = await groupsRes.json();
  console.log('GROUPS RESPONSE STATUS:', groupsRes.status, 'ITEMS:', groupsData.items?.length);
  if (groupsData.items) {
    console.log('GROUPS:', groupsData.items);
  }
}
testGroups();
