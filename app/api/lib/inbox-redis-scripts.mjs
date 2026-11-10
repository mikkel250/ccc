/** Inbox Redis scripts shared by the store and the local Upstash mock. */
export const DELETE_IF_VALUE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export const EXPIRE_IF_OWNED_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], tonumber(ARGV[2])) else return 0 end';

export const MARK_PROCESSED_IF_OWNED_SCRIPT = `
local current = redis.call("get", KEYS[1])
if current ~= ARGV[1] then
  return 0
end
if tonumber(ARGV[2]) > 0 then
  redis.call("set", KEYS[2], "1", "EX", ARGV[2])
else
  redis.call("set", KEYS[2], "1")
end
redis.call("del", KEYS[1])
return 1
`;
