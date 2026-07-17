local Size = 50

local runs = game:GetService("RunService")
local collection = game:GetService("CollectionService")
local plrs = game:GetService("Players")
local space = game:GetService("Workspace")
local cam = space.CurrentCamera

local visuals_color = Color3.fromRGB(180, 20, 140)

local container = Instance.new("Folder", space)
local land = Instance.new("Part")
land.Shape = Enum.PartType.Cylinder
land.Size = Vector3.new(.1, 6, 6)
land.Color = visuals_color
land.Material = Enum.Material.Neon
land.Transparency = 1
land.CanCollide = false
land.Anchored = true
land.Rotation = Vector3.new(0, 0, 90)
land.Parent = container

local lines = {}
local history = {}
local points, rays = {}, nil
local smooth = nil
local fc = 0

local params = RaycastParams.new()
params.FilterType = Enum.RaycastFilterType.Exclude

local function blacklist()
    local ignore = {container}
    for _, ball in ipairs(collection:GetTagged("Ball")) do
        table.insert(ignore, ball)
        local ind = ball:FindFirstChild("CenterIndicator")
        if ind then table.insert(ignore, ind) end
    end
    for _, plr in ipairs(plrs:GetPlayers()) do
        if plr.Character then table.insert(ignore, plr.Character) end
    end
    params.FilterDescendantsInstances = ignore
end

local function estimate()
    local n = #history
    if n < 2 then return Vector3.new() end
    
    local baseTime = history[1].Time
    local t0, t_0 = 0, 0
    local x, y, z = 0, 0, 0
    local xt, yt, zt = 0, 0, 0
    
    for i = 1, n do
        local s = history[i]
        local t = s.Time - baseTime
        t0 += t
        t_0 += t * t
        x += s.Pos.X; xt += s.Pos.X * t
        y += s.Pos.Y; yt += s.Pos.Y * t
        z += s.Pos.Z; zt += s.Pos.Z * t
    end
    
    local d = n * t_0 - t0 * t0
    if math.abs(d) < 1e-9 then return Vector3.new() end
    return Vector3.new((n * xt - t0 * x) / d, (n * yt - t0 * y) / d, (n * zt - t0 * z) / d)
end

local function trajectory(start, estimated)
    local path = {start}
    local cpos, cvel = start, estimated
    local dt = .016666
    local gravity = Vector3.new(0, -28, 0)
    
    for _ = 1, 180 do
        local npos = cpos + (cvel * dt) + (.5 * gravity * dt * dt)
        local dir = npos - cpos
        
        local ray = space:Raycast(cpos, dir, params)
        
        if not ray and cvel.Y < -5 and math.abs(cvel.Y) > math.abs(cvel.X) + math.abs(cvel.Z) then
            local wall = Vector3.new(cvel.X, 0, cvel.Z).Unit * 4
            if wall.Magnitude > 0 then
                ray = space:Raycast(cpos, wall, params)
            end
        end
        
        if ray then
            table.insert(path, ray.Position)
            return path, ray
        end
        
        cpos = npos
        cvel = cvel + (gravity * dt)
        table.insert(path, cpos)
    end
    return path, nil
end

local function draw(list)
    local total = #list - 1
    for i = #lines, total + 1, -1 do
        if lines[i] then lines[i].Visible = false end
    end
    for i = 1, total do
        local a, ona = cam:WorldToViewportPoint(list[i])
        local b, onb = cam:WorldToViewportPoint(list[i + 1])
        local line = lines[i] or Drawing.new("Line")
        line.Thickness = 2.5
        line.Color = visuals_color
        lines[i] = line
        if ona or onb then
            line.From = Vector2.new(a.X, a.Y)
            line.To = Vector2.new(b.X, b.Y)
            line.Visible = true
        else
            line.Visible = false
        end
    end
end

local function resize(ball)
    local part = ball:IsA("BasePart") and ball or (ball.PrimaryPart or ball:FindFirstChildWhichIsA("BasePart"))
    if part and not part:FindFirstChild("CenterIndicator") then
        local indicator = Instance.new("Part")
        indicator.Name = "CenterIndicator"
        indicator.Shape = Enum.PartType.Ball
        indicator.Size = part.Size
        indicator.Color = Color3.new(0, 0, 0)
        indicator.CanCollide = false
        indicator.Massless = true
        indicator.CFrame = part.CFrame
        indicator.Parent = part

        local highlight = Instance.new("Highlight")
        highlight.FillColor = Color3.fromRGB(255, 0, 0)
        highlight.FillTransparency = 0
        highlight.OutlineTransparency = 1
        highlight.Adornee = indicator
        highlight.Parent = indicator

        local weld = Instance.new("WeldConstraint")
        weld.Part0, weld.Part1, weld.Parent = part, indicator, indicator
        part.Size = Vector3.new(Size, Size, Size)
        part.Transparency = 0.75
        blacklist()
    end
end

for _, ball in ipairs(collection:GetTagged("Ball")) do task.spawn(resize, ball) end
collection:GetInstanceAddedSignal("Ball"):Connect(function(ball) task.defer(resize, ball) end)
plrs.PlayerAdded:Connect(blacklist)
plrs.PlayerRemoving:Connect(blacklist)

runs.RenderStepped:Connect(function(dt)
    local active
    for _, ball in ipairs(collection:GetTagged("Ball")) do
        if ball.Parent then active = ball break end
    end

    if active then
        local cpos = active:GetPivot().Position
        table.insert(history, {Pos = cpos, Time = os.clock()})
        if #history > 8 then table.remove(history, 1) end
        
        fc += 1
        if fc >= 2 then
            fc = 0
            points, rays = trajectory(cpos, estimate())
        end
        draw(points)
        if rays then
            smooth = smooth and smooth:Lerp(rays.Position, math.min(1, dt * 10)) or rays.Position
            land.Position = smooth
            land.Transparency = .4
        else
            smooth = nil
            land.Transparency = 1
        end
    else
        history = {}
        fc = 0
        points, rays = {}, nil
        smooth = nil
        for i = 1, #lines do 
            if lines[i] then lines[i].Visible = false end 
        end
        land.Transparency = 1
    end
end)
