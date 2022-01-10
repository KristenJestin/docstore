using Docstore.App.Common;
using FluentValidation.AspNetCore;
using Microsoft.EntityFrameworkCore;
using System.Text;

var builder = WebApplication.CreateBuilder(args);
var assembly = typeof(Program).Assembly;

// Add services to the container.
builder.Services.AddDbContext<AppDbContext>(options => options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

var mvcBuilder = builder.Services
    .AddControllersWithViews()
    .AddFluentValidation(fv => fv.RegisterValidatorsFromAssembly(assembly));

builder.Services.AddAutoMapper(assembly);

#if DEBUG
mvcBuilder.AddRazorRuntimeCompilation();
#endif

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();

app.UseRouting();

app.UseAuthorization();

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");

app.Run();
