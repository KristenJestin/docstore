﻿using Docstore.App.Models;
using Docstore.Application.Interfaces;
using Docstore.Domain.Extensions;
using Docstore.Persistence.Contexts;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Diagnostics;

namespace Docstore.App.Controllers
{
    public class HomeController : Controller
    {
        private const int PAGE_SIZE = 15;

        private readonly ILogger<HomeController> _logger;
        private readonly AppDbContext _db;
        private readonly IDocumentRepository _documentRepository;

        public HomeController(ILogger<HomeController> logger, AppDbContext db, IDocumentRepository documentRepository)
        {
            _logger = logger;
            _db = db;
            _documentRepository = documentRepository;
        }


        #region actions
        public async Task<IActionResult> Index(int? page = 1)
        {
            // get data
            var lastDocuments = await _db.Documents
                .OrderByDescending(d => d.UpdatedAt)
                .Include(d => d.Folder)
                .Include(d => d.Tags)
                .Take(3)
                .ToListAsync();
            var documents = await _documentRepository.GetPagedReponseAsync(page ?? 1, PAGE_SIZE, where: d => d.FolderId == null);
            var folders = await _db.Folders
                .OrderBy(d => d.Name)
                .Take(PAGE_SIZE)
                // TODO: save in database size and count when inserting and updating files
                .Select(f => f.WithDocumentsCount(f.Documents.Count).WithSize(f.Documents.Sum(docu => docu.Files.Sum(file => file.Size))))
                .ToListAsync();

            // response
            var viewModel = new HomeIndexViewModel
            {
                LastDocuments = lastDocuments,
                Documents = documents,
                Folders = folders
            };
            return View(viewModel);
        }

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error()
        {
            return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
        }
        #endregion
    }
}